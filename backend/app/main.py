"""FastAPI entry point. Run from backend/:  .venv/Scripts/python -m uvicorn app.main:app --reload"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import api_football, llm, metrics, plan, players, rating, report, skills, tier1
from app.text import plain_dashes
from app.coach.routes import router as coach_router
from app.db import init_db

app = FastAPI(title="SoccerScout API")
init_db()
# Live Skills Coach: separate router and separate database (see app/coach/).
app.include_router(coach_router)

# The Vite dev server proxies /api, but allow direct calls during development too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def statsbomb_id(key: str) -> int:
    """'sb-5503' -> 5503. Tier 1 keys ('af-...') are handled by the API-Football routes."""
    if not key.startswith("sb-"):
        raise HTTPException(404, "Full analysis is only available for StatsBomb (Tier 2) players")
    try:
        return int(key[3:])
    except ValueError:
        raise HTTPException(404, "Unknown player key")


def valid_scope(player_id: int, scope: str | None) -> str:
    seasons = players.player_seasons(player_id)
    if seasons.empty:
        raise HTTPException(404, "Player not found")
    scope = scope or players.default_scope(player_id)
    allowed = {"all"} | {f"{int(s.competition_id)}-{int(s.season_id)}" for s in seasons.itertuples()}
    if scope not in allowed:
        raise HTTPException(404, f"No data for scope {scope}")
    return scope


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/players/search")
def search(q: str = Query(..., min_length=1)):
    """Autocomplete: StatsBomb players (demo first), then API-Football results already in the cache.
    Never spends an API request, so typing is free."""
    return {"results": players.search(q) + tier1.search(q, allow_network=False)[:5]}


@app.get("/api/players/search/remote")
def search_remote(q: str = Query(..., min_length=3)):
    """Explicit "search more leagues": one API-Football request per new query, cached forever."""
    try:
        remote = tier1.search(q, allow_network=True)
    except api_football.ApiFootballError as exc:
        raise HTTPException(503, str(exc))
    return {"results": players.search(q) + remote, "requests_today": api_football.requests_today()}


def api_football_id(key: str) -> int | None:
    if key.startswith("af-") and key[3:].isdigit():
        return int(key[3:])
    return None


def tier1_call(fn, api_id: int):
    try:
        return fn(api_id)
    except KeyError:
        raise HTTPException(404, f"API-Football has no {tier1.SEASON}/{tier1.SEASON + 1 - 2000} league minutes for this player")
    except api_football.ApiFootballError as exc:
        raise HTTPException(503, str(exc))


@app.get("/api/players")
def list_players(q: str = Query("", max_length=60), group: str | None = Query(None, pattern="^(GK|DEF|MID|FWD)$"),
                 sort: str = Query("minutes", pattern="^(minutes|name|seasons)$"),
                 page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=players.MAX_PAGE_SIZE)):
    """All players in the dataset: search, position filter, sort, pagination."""
    return players.list_players(q, group, sort, page, page_size)


@app.get("/api/players/featured")
def featured():
    return {"results": players.featured()}


@app.get("/api/metrics/definitions")
def definitions():
    """Metric definitions for the UI info tooltips."""
    return {
        "progressive_pass": "A completed pass that moves the ball at least 10 m closer to the centre of the "
                            "opponent's goal, or any completed pass into the penalty box. Passes starting in the "
                            "player's own defensive third are excluded, and corners don't count.",
        "progressive_carry": "A carry that moves the ball at least 10 m closer to the centre of the opponent's goal, "
                             "or into the penalty box, excluding carries starting in the own defensive third.",
        "per_90": "Total divided by minutes played, times 90.",
        "percentile": f"Rank against every player-season in the same position group with at least "
                      f"{metrics.MIN_MINUTES} minutes in the dataset.",
        "pool_note": "The pool covers every La Liga player in 2015/16 (a full season in StatsBomb Open Data), "
                     "Barcelona players in the other 2004/05-2020/21 seasons (only Barcelona matches are "
                     "available), and the 2022 World Cup.",
        "stats": metrics.STATS,
    }


@app.get("/api/players/{key}/profile")
def profile(key: str, scope: str | None = None):
    if (api_id := api_football_id(key)) is not None:
        return tier1_call(tier1.profile, api_id)
    pid = statsbomb_id(key)
    try:
        return players.profile(pid, valid_scope(pid, scope))
    except (KeyError, IndexError):
        raise HTTPException(404, "Player not found")


@app.get("/api/players/{key}/passes")
def passes(key: str, scope: str | None = None, filter: str = "all"):
    if filter not in {"all", "progressive", "under_pressure"}:
        raise HTTPException(400, "filter must be all, progressive or under_pressure")
    pid = statsbomb_id(key)
    return players.pass_map(pid, valid_scope(pid, scope), filter)


@app.get("/api/players/{key}/shots")
def shots(key: str, scope: str | None = None):
    pid = statsbomb_id(key)
    return players.shot_map(pid, valid_scope(pid, scope))


@app.get("/api/players/{key}/heatmap")
def heatmap(key: str, scope: str | None = None):
    pid = statsbomb_id(key)
    return players.heat_map(pid, valid_scope(pid, scope))


@app.get("/api/players/{key}/pass-network")
def pass_network(key: str, scope: str | None = None):
    pid = statsbomb_id(key)
    return players.pass_network(pid, valid_scope(pid, scope))


@app.get("/api/players/{key}/card")
def card(key: str, scope: str | None = None):
    """Game-style card built from the profile's percentiles (see config/rating.json)."""
    return card_for(key, scope)


def report_response(summary: dict) -> dict:
    """Generate (or load from cache) the AI report for a summary, plus what the UI needs to show evidence."""
    try:
        result = report.generate(summary)
    except llm.LlmError as exc:
        raise HTTPException(503, str(exc))
    return {
        "report": plain_dashes(result["data"]), "model": result["model"], "cached": result["cached"],
        "created_at": result["created_at"], "summary": summary,
        "evidence": report.evidence_index(summary),
    }


@app.get("/api/players/{key}/report")
def scouting_report(key: str, scope: str | None = None):
    """AI scouting report. Built from a JSON summary (never raw events); cached after the first call."""
    if (api_id := api_football_id(key)) is not None:
        return report_response(tier1_call(tier1.summary, api_id))
    pid = statsbomb_id(key)
    return report_response(report.summarize_tier2(pid, valid_scope(pid, scope)))


# ---------------------------------------------------------------------------
# User skill tests (Step 10)
# ---------------------------------------------------------------------------

class SkillTestsIn(BaseModel):
    name: str = Field("Me", max_length=60)
    age: int = Field(..., ge=6, le=80)
    position_group: str = Field("MID", pattern="^(FWD|MID|DEF)$")
    results: dict[str, float | None] = {}
    self_assessment: dict[str, int] = {}


class ProfileNameIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)


@app.get("/api/self-assessment/config")
def self_assessment_config():
    """Questions for the physical and defending self-assessment."""
    return skills.self_assessment_config()


@app.patch("/api/me")
def rename_me(body: ProfileNameIn):
    """Change the display name. Updates the current profile; no new row is created."""
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(422, "The name can't be blank")
    profile = skills.rename_profile(name)
    if profile is None:
        raise HTTPException(404, "No profile yet. Save your skill tests first.")
    return profile


@app.get("/api/skills/config")
def skills_config():
    """Test instructions, units and benchmark tables for the form."""
    return skills.config()


@app.get("/api/me")
def get_me():
    profile = skills.load_profile()
    if profile is None:
        raise HTTPException(404, "No skill-test results yet")
    return profile


@app.post("/api/me")
def save_me(body: SkillTestsIn):
    tests = {t["id"]: t for t in skills.config()["tests"]}
    results = {}
    for test_id, value in body.results.items():
        if test_id not in tests:
            raise HTTPException(400, f"Unknown test {test_id}")
        if value is not None and not (0 <= value <= tests[test_id]["max"]):
            raise HTTPException(400, f"{tests[test_id]['name']}: {value} is outside 0–{tests[test_id]['max']}")
        results[test_id] = value
    questions = {q["id"]: q for q in skills.self_assessment_config()["questions"]}
    for qid, answer in body.self_assessment.items():
        if qid not in questions:
            raise HTTPException(400, f"Unknown question {qid}")
        if not 1 <= answer <= len(questions[qid]["options"]):
            raise HTTPException(400, f"Answer for {qid} must be 1 to {len(questions[qid]['options'])}")
    if all(v is None for v in results.values()) and not body.self_assessment:
        raise HTTPException(400, "Enter at least one test result or answer at least one question")
    return skills.save_profile(" ".join(body.name.split()) or "Me", body.age, body.position_group, results,
                               body.self_assessment)


def card_for(key: str, scope: str | None) -> dict:
    """The card endpoint's payload for any player key (Tier 1 or 2)."""
    if (api_id := api_football_id(key)) is not None:
        return tier1_call(tier1.card, api_id)
    pid = statsbomb_id(key)
    p = players.profile(pid, valid_scope(pid, scope))
    return {"name": p["name"], "team": p["team"], "scope_label": p["scope_label"],
            "card": rating.build_card(p["stats"], p["position_group"], p["minutes"], tier=2)}


@app.get("/api/compare")
def compare(target: str, scope: str | None = None):
    me = skills.load_profile()
    if me is None:
        raise HTTPException(404, "Enter your skill-test results first")
    target_card = card_for(target, scope)
    return {
        "user": {"name": me["name"], "card": me["card"]},
        "target": {"key": target, **target_card},
        "gaps": skills.compare(me["card"], target_card["card"]),
        "note": skills.EVIDENCE_NOTE,
    }


# ---------------------------------------------------------------------------
# "Train Like Him" plan (Step 11)
# ---------------------------------------------------------------------------

class PlanIn(BaseModel):
    target: str
    scope: str | None = None
    sessions_per_week: int = Field(3, ge=1, le=6)
    minutes_per_session: int = Field(45, ge=20, le=120)
    equipment: list[str] = ["ball"]


@app.post("/api/plan")
def make_plan(body: PlanIn):
    """7-day plan for the saved user vs a target player. Same inputs -> cached plan."""
    me = skills.load_profile()
    if me is None:
        raise HTTPException(404, "Enter your skill-test results in My Profile first")
    target = card_for(body.target, body.scope)
    gaps = skills.compare(me["card"], target["card"])
    try:
        return plain_dashes(plan.build(me, target["name"], target["card"], gaps, body.sessions_per_week,
                                       body.minutes_per_session, body.equipment))
    except (plan.PlanError, llm.LlmError) as exc:
        raise HTTPException(503, str(exc))
