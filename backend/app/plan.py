"""'Train Like Him': a 7-day plan built around the user's biggest gaps to a target player.

Code decides the structure, so the rules always hold:
- the 2-3 focus attributes (largest gaps between the user's card and the target's card),
- which days are training / rest (spread over days 1-6),
- day 7 = re-test of the skill battery (straight from config/benchmarks.json, not the LLM).
The LLM only writes the session content, and its JSON is validated: equipment must be a subset of
what the user has, each main drill has the three progression levels, durations fit the time.
"""
import json

from app import llm, skills
from app.report import ordinal

PLAN_DAYS = 7
LEVELS = ["No defender", "Passive defender", "Active defender"]
EQUIPMENT = ["ball", "cones", "wall", "goal", "partner"]
# Training days (within days 1-6) for each sessions-per-week value: spread out, rest in between.
TRAINING_DAYS = {1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6]}

SYSTEM_PROMPT = """You are a football coach writing individual training sessions for an amateur player.
You receive JSON with: the focus attributes (with the player's test results and the target pro's stats),
the training days to fill, minutes per session, and the equipment the player has.

Rules:
1. Use ONLY the listed equipment. Each session's "equipment" list must be a subset of it. If "partner" is not
   listed, the player trains alone: never require a partner, teammate or defender in person.
2. Every main drill has exactly three progression levels, in order, with these exact names:
   "No defender", "Passive defender", "Active defender". When there is no partner, describe a solo substitute
   in the level's description (e.g. a cone as a static defender, a shadow defender you imagine, a time limit)
   and start that description with "Solo version:".
3. warm_up + main_drill + game_like + cool_down minutes must add up to the session duration, which must not
   exceed the minutes per session.
4. Each session trains its assigned focus attribute. Link the objective to the gap (you may cite the target's
   numbers that are provided, never other facts about the pro).
5. Success criteria are measurable (counts, times, percentages) so the player knows if they passed.
6. Plain, encouraging language. Safety first: include a proper warm-up; sprint work only after the warm-up.

Reply with ONE JSON object, no other text, in exactly this shape:
{
  "title": "short plan title",
  "summary": "2 sentences on what the week targets and why",
  "sessions": [
    {
      "day": 1,
      "focus": "DRI",
      "objective": "one sentence",
      "duration_min": 45,
      "equipment": ["ball", "cones"],
      "warm_up": {"minutes": 8, "activities": ["...", "..."]},
      "main_drill": {
        "name": "...", "minutes": 20, "setup": "...", "instructions": "...",
        "progressions": [
          {"level": "No defender", "description": "..."},
          {"level": "Passive defender", "description": "..."},
          {"level": "Active defender", "description": "..."}
        ],
        "reps": "e.g. 6 x 45 s", "rest": "e.g. 60 s between reps"
      },
      "game_like": {"name": "...", "minutes": 12, "description": "..."},
      "cool_down": {"minutes": 5, "activities": ["..."]},
      "success_criteria": ["...", "..."]
    }
  ]
}
Write one session per training day listed in the input, in the same order."""


class PlanError(Exception):
    pass


def choose_focuses(gaps: list[dict], user_card: dict, count: int = 3) -> list[dict]:
    """The 2-3 largest positive gaps. If fewer than 2 exist, add the user's weakest measured attributes."""
    measurable = [g for g in gaps if g["gap"] is not None]
    chosen = sorted([g for g in measurable if g["gap"] > 0], key=lambda g: -g["gap"])[:count]
    if len(chosen) < 2:
        rest = sorted([g for g in measurable if g not in chosen], key=lambda g: g["user"])
        chosen += rest[:2 - len(chosen)]
    return chosen


def focus_details(focuses: list[dict], user_card: dict, target_card: dict) -> list[dict]:
    """What the LLM (and the UI) needs to know about each focus: the user's tests and the pro's evidence."""
    out = []
    for f in focuses:
        code = f["attribute"]
        user_tests = [f"{e['label']}: {e['display']} (score {e['score']})" for e in user_card["attributes"][code]["evidence"]]
        target_stats = [f"{e['label']}: {e['value']}{'%' if e['kind'] == 'pct' else ' per 90' if e['kind'] == 'p90' else ''}"
                        + (f" ({ordinal(round(e['percentile']))} percentile)" if e.get("percentile") is not None else "")
                        for e in target_card["attributes"][code]["evidence"]]
        item = {"attribute": code, "label": f["label"], "user": f["user"], "target": f["target"], "gap": f["gap"],
                "user_tests": user_tests, "target_stats": target_stats}
        if user_card["attributes"][code].get("source") == "self_reported":
            # Only present when relevant, so plans without self-assessment answers are unchanged.
            item["user_level_basis"] = ("Self-reported: the player's own answers to a questionnaire, not a measurement. "
                                        "Say so when you refer to this level.")
        out.append(item)
    return out


def physical_context(user: dict) -> dict:
    """Self-reported stamina/recovery answers, used only to set rest and volume (added only if answered)."""
    answers = user.get("self_assessment") or {}
    questions = {q["id"]: q for q in skills.self_assessment_config()["questions"]}
    picked = {qid: questions[qid]["options"][a - 1] for qid, a in answers.items()
              if qid in ("stamina", "recovery") and qid in questions and 1 <= a <= len(questions[qid]["options"])}
    if not picked:
        return {}
    return {"physical_self_assessment": {
        "note": "Self-reported by the player, not measured. Use it only to set rest periods and session volume.",
        **picked}}


def retest_day(user_results: dict, equipment: set[str]) -> dict:
    """Day 7: the full skill battery again, with last time's result to beat."""
    tests = []
    for t in skills.config()["tests"]:
        missing = [e for e in t["equipment"] if e not in equipment]
        previous = user_results.get(t["id"])
        tests.append({
            "id": t["id"], "name": t["name"], "unit": t["unit"], "better": t["better"],
            "instructions": t["instructions"], "previous": previous,
            "skip_reason": f"needs {', '.join(missing)}" if missing else None,
        })
    return {"day": PLAN_DAYS, "type": "retest", "title": "Re-test day",
            "note": "Warm up for 10 minutes, then repeat the skill battery. Enter the new results in My Profile "
                    "to see your updated card.", "tests": tests}


def validate(skeleton_days: list[int], focus_by_day: dict, minutes: int, equipment: set[str]):
    has_partner = "partner" in equipment

    def check(data: dict) -> list[str]:
        problems = []
        sessions = data.get("sessions")
        if not isinstance(sessions, list):
            return ["'sessions' must be a list"]
        days = [s.get("day") for s in sessions]
        if days != skeleton_days:
            problems.append(f"sessions must be for days {skeleton_days} in order, got {days}")
        for s in sessions:
            day = s.get("day")
            extra = set(s.get("equipment", [])) - equipment
            if extra:
                problems.append(f"day {day} uses equipment the player doesn't have: {sorted(extra)}")
            if s.get("focus") != focus_by_day.get(day):
                problems.append(f"day {day} focus must be {focus_by_day.get(day)}")
            levels = [p.get("level") for p in s.get("main_drill", {}).get("progressions", [])]
            if levels != LEVELS:
                problems.append(f"day {day} progressions must be exactly {LEVELS}")
            parts = [s.get(k, {}).get("minutes", 0) for k in ("warm_up", "main_drill", "game_like", "cool_down")]
            if sum(parts) > minutes or s.get("duration_min", 0) > minutes:
                problems.append(f"day {day} lasts {sum(parts)} min; the limit is {minutes}")
            if not has_partner:
                text = json.dumps(s).lower()
                if any(w in text for w in ["your partner", "a partner", "with a partner", "teammate"]):
                    problems.append(f"day {day} needs a partner, but the player trains alone")
        return problems
    return check


def build(user: dict, target_name: str, target_card: dict, gaps: list[dict],
          sessions_per_week: int, minutes: int, equipment: list[str]) -> dict:
    equipment_set = {e for e in equipment if e in EQUIPMENT}
    focuses = focus_details(choose_focuses(gaps, user["card"]), user["card"], target_card)
    if not focuses:
        raise PlanError("No attributes to compare yet. Enter more skill tests in My Profile.")

    days = TRAINING_DAYS[sessions_per_week]
    focus_by_day = {day: focuses[i % len(focuses)]["attribute"] for i, day in enumerate(days)}
    request = {
        "target_player": target_name,
        "player": {"age": user["age"], "age_group": user["card"]["age_group"], "position": user["position_group"]},
        "focus_attributes": focuses,
        "training_days": [{"day": d, "focus": focus_by_day[d]} for d in days],
        "minutes_per_session": minutes,
        "equipment": sorted(equipment_set),
        "trains_alone": "partner" not in equipment_set,
        **physical_context(user),
    }
    result = llm.complete_json("plan", SYSTEM_PROMPT, json.dumps(request, ensure_ascii=False, indent=1),
                               ["title", "summary", "sessions"],
                               validate=validate(days, focus_by_day, minutes, equipment_set))
    data = result["data"]
    by_day = {s["day"]: {**s, "type": "session"} for s in data["sessions"]}
    calendar = []
    for day in range(1, PLAN_DAYS):
        calendar.append(by_day.get(day) or {"day": day, "type": "rest", "title": "Rest / recovery",
                                            "note": "Rest, or 15–20 minutes of easy mobility and light ball touches."})
    calendar.append(retest_day(user["results"], equipment_set))
    return {
        "title": data["title"], "summary": data["summary"], "days": calendar, "focuses": focuses,
        "inputs": {"target": target_name, "sessions_per_week": sessions_per_week, "minutes_per_session": minutes,
                   "equipment": sorted(equipment_set)},
        "model": result["model"], "cached": result["cached"],
    }
