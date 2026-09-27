"""AI scouting report.

1. summarize(): a compact JSON summary of the player (identity, stats + percentiles, zones, patterns).
   Raw events are never sent to the LLM.
2. suggest_archetypes(): simple rules from config/archetypes.json pick the archetypes; the LLM only
   explains them.
3. generate(): prompt -> JSON report, validated so every piece of evidence refers to a real number
   in the summary. Cached by llm.complete_json.
"""
import json
from functools import lru_cache

import numpy as np

from app import llm, metrics, players, rating
from app.settings import CONFIG_DIR

SYSTEM_PROMPT = """You are a football scouting analyst. You write for players and coaches.
You receive a JSON summary of ONE player's data. Follow these rules strictly:

1. Only make claims supported by the numbers in the summary. Never add facts from your own memory
   (no transfer history, trophies, reputation, injuries or anything not in the summary).
2. Every archetype, strength, development area and training item must cite evidence: a list of keys
   from the summary's "evidence_keys". Use only those keys.
3. Do NOT mention scanning, body orientation, speed, pace, acceleration, strength, stamina, or technique
   quality (first touch, striking technique, etc.). This data cannot measure them.
4. Percentiles compare the player with the "comparison_pool" described in the summary. Say "compared with
   the pool" rather than "in the world".
5. Use only the archetype names given in "archetype_candidates". Explain why the evidence fits.
6. For development areas, pick relatively low percentiles that matter for the position, and note when a
   low number simply reflects the role (e.g. a winger making few interceptions).
7. Training translation: turn the standout patterns into things an amateur player can practise.
8. Plain English, short sentences, no hype. Mention numbers as "X per 90 (Nth percentile)".

Reply with ONE JSON object and nothing else, in exactly this shape:
{
  "identity": "one sentence describing who this player is on the pitch",
  "archetypes": [{"name": "...", "explanation": "...", "evidence": ["key", ...]}],
  "how_they_play": "3-4 sentences",
  "strengths": [{"title": "...", "detail": "...", "evidence": ["key", ...]}],
  "development_areas": [{"title": "...", "detail": "...", "evidence": ["key", ...]}],
  "best_tactical_environment": "2-3 sentences",
  "training_translation": [{"focus": "...", "why": "...", "evidence": ["key", ...]}]
}
Give 3-4 strengths, 2-3 development areas and 2-3 training items."""

TIER1_NOTE = """This is a Tier 1 player: only season totals from a different provider (API-Football) are
available. There are no pitch locations, so do not describe zones or movement. Keep the report short,
say clearly that the evidence is limited, and treat percentiles as rough."""

REQUIRED = ["identity", "archetypes", "how_they_play", "strengths", "development_areas",
            "best_tactical_environment", "training_translation"]


@lru_cache(maxsize=1)
def archetype_rules() -> list[dict]:
    return json.loads((CONFIG_DIR / "archetypes.json").read_text(encoding="utf-8"))["rules"]


def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def fmt_stat(s: dict) -> str:
    if s["value"] is None:
        return "n/a"
    value = f"{s['value']:.1f}%" if s["kind"] == "pct" else f"{s['value']:.2f}" + (" per 90" if s["kind"] == "p90" else "")
    return value + (f" ({ordinal(round(s['percentile']))} percentile)" if s["percentile"] is not None else "")


def key_stats_for(group: str) -> set[str]:
    """Stats that matter most for a position group: those in attributes weighted >= 25% in its OVR."""
    cfg = rating.config()
    weights = cfg["ovr_weights"].get(group, {})
    keys = {k for attr, w in weights.items() if w >= 0.25 for k in cfg["attributes"][attr]["stats"]}
    return keys | {k.removesuffix("_padj") for k in keys}   # Tier 1 only has the raw versions


# ---------------------------------------------------------------------------
# Archetypes
# ---------------------------------------------------------------------------

def suggest_archetypes(stats: list[dict], zones: dict, group: str) -> list[dict]:
    """Rules first, AI second: return up to 3 matching archetypes with the evidence that triggered them."""
    pct = {s["key"]: s["percentile"] for s in stats}
    by_key = {s["key"]: s for s in stats}
    matches = []
    for rule in archetype_rules():
        if group not in rule["groups"]:
            continue
        checks, margins, evidence = [], [], []
        for key, minimum in rule.get("min", {}).items():
            ok = pct.get(key) is not None and pct[key] >= minimum
            checks.append(ok)
            if ok:
                margins.append(pct[key] - minimum)
                evidence.append(f"{by_key[key]['label']}: {fmt_stat(by_key[key])}")
        for key, maximum in rule.get("max", {}).items():
            ok = pct.get(key) is not None and pct[key] <= maximum
            checks.append(ok)
            if ok:
                margins.append(maximum - pct[key])
                evidence.append(f"{by_key[key]['label']}: {fmt_stat(by_key[key])}")
        for key, minimum in rule.get("zones_min", {}).items():
            ok = zones.get(key) is not None and zones[key] >= minimum
            checks.append(ok)
            if ok:
                margins.append(zones[key] - minimum)
                evidence.append(f"{key.replace('_', ' ')}: {zones[key]}%")
        if checks and all(checks):
            matches.append({"name": rule["name"], "score": float(np.mean(margins)), "evidence": evidence})
    matches.sort(key=lambda m: m["score"], reverse=True)
    if not matches:   # nothing stands out: describe the player as balanced, citing their best stats
        relevant = key_stats_for(group)
        top = sorted([s for s in stats if s["percentile"] is not None and s["key"] in relevant],
                     key=lambda s: -s["percentile"])[:3]
        matches = [{"name": f"Balanced {metrics.GROUP_NAMES.get(group, group).lower().rstrip('s')}", "score": 0,
                    "evidence": [f"{s['label']}: {fmt_stat(s)}" for s in top]}]
    return [{"name": m["name"], "evidence": m["evidence"]} for m in matches[:3]]


# ---------------------------------------------------------------------------
# Summary (Tier 2)
# ---------------------------------------------------------------------------

def patterns(player_id: int, scope: str) -> tuple[dict, dict]:
    """Zones and recurring patterns from the event data, as small numbers (no raw events)."""
    heat = players.heat_map(player_id, scope)
    receipts = players.events(player_id, scope, ("Ball Receipt*",)).dropna(subset=["y"])
    wide = receipts[(receipts["y"] < 18) | (receipts["y"] > 62)]
    zones = {
        "thirds_pct": heat["thirds_pct"],
        "lanes_pct": heat["lanes_pct"],
        "wide_reception_pct": round(len(wide) / len(receipts) * 100, 1) if len(receipts) else None,
        "wide_receptions_side": ("left" if (wide["y"] < 18).sum() > (wide["y"] > 62).sum() else "right") if len(wide) else None,
    }

    passes = players.pass_map(player_id, scope, "all")
    all_passes = players.events(player_id, scope, ("Pass",))
    all_passes = all_passes[all_passes["pass_type"] != "Throw-in"]
    pressured = all_passes[all_passes["under_pressure"].astype(bool)]
    shots = players.shot_map(player_id, scope)
    shot_rows = shots["shots"]
    in_box = [s for s in shot_rows if s["x"] is not None and metrics.in_box(s["x"], s["y"])]
    headers = [s for s in shot_rows if s["body_part"] == "Head"]
    network = players.pass_network(player_id, scope, top=3)
    pats = {
        "progressive_pass_share_pct": round(passes["counts"]["progressive"] / passes["counts"]["all"] * 100, 1)
        if passes["counts"]["all"] else None,
        "pass_completion_under_pressure_pct": round(float(pressured["pass_outcome"].isna().mean()) * 100, 1)
        if len(pressured) else None,
        "shots_inside_box_pct": round(len(in_box) / len(shot_rows) * 100, 1) if shot_rows else None,
        "headed_shots_pct": round(len(headers) / len(shot_rows) * 100, 1) if shot_rows else None,
        "goals_minus_xg": round(shots["summary"]["goals"] - shots["summary"]["xg"], 2),
        "top_pass_targets": [f"{n['name']} ({n['passes']})" for n in network["passes_to"]],
        "top_suppliers": [f"{n['name']} ({n['passes']})" for n in network["receives_from"]],
    }
    return zones, pats


@lru_cache(maxsize=256)   # the summary is deterministic, so rebuild it once per player-scope per process
def summarize_tier2(player_id: int, scope: str) -> dict:
    p = players.profile(player_id, scope)
    zones, pats = patterns(player_id, scope)
    foot = p["preferred_foot"]
    stats = [{"key": s["key"], "label": s["label"], "value": s["value"], "percentile": s["percentile"],
              "unit": "per 90" if s["kind"] == "p90" else ("%" if s["kind"] == "pct" else "ratio")}
             for s in p["stats"]]
    summary = {
        "data_tier": 2,
        "player": {"name": p["name"], "position": p["position"], "position_group": p["position_group_name"],
                   "team": p["team"], "scope": p["scope_label"], "minutes": p["minutes"], "matches": p["matches"],
                   "preferred_foot": f"{foot['foot']} ({foot['share']}% of foot passes)" if foot["foot"] else None},
        "comparison_pool": f"{p['pool']['size']} {p['position_group_name'].lower()} player-seasons with "
                           f"{p['pool']['min_minutes']}+ minutes (StatsBomb Open Data: La Liga, mostly Barcelona "
                           f"plus the full 2015/16 season, and the 2022 World Cup)",
        "definitions": {
            "PAdj": "possession-adjusted: defensive actions scaled by how much of the ball the opponent had",
            "per 90": "total divided by minutes played, times 90",
            "progressive": "moves the ball at least 10 m closer to the opponent's goal, or into the box",
            "lanes_pct": "share of on-ball actions in the left / central / right lanes",
            "thirds_pct": "share of on-ball actions in the defensive / middle / attacking third",
        },
        "stats": stats,
        "zones": zones,
        "patterns": pats,
        "archetype_candidates": suggest_archetypes(p["stats"], zones, p["position_group"]),
    }
    summary["evidence_keys"] = evidence_keys(summary)
    return summary


def evidence_keys(summary: dict) -> list[str]:
    keys = [s["key"] for s in summary["stats"] if s["value"] is not None]
    keys += [k for k, v in summary.get("zones", {}).items() if v is not None and k != "wide_receptions_side"]
    keys += [k for k, v in summary.get("patterns", {}).items() if v is not None and not (isinstance(v, list) and not v)]
    return keys


def evidence_index(summary: dict) -> dict:
    """key -> {label, display} so the UI can show each cited number next to the claim."""
    index = {s["key"]: {"label": s["label"], "display": fmt_stat({**s, "kind": {"per 90": "p90", "%": "pct"}.get(s["unit"], "ratio")})}
             for s in summary["stats"]}
    for group in ("zones", "patterns"):
        for key, value in summary.get(group, {}).items():
            if isinstance(value, dict):
                display = ", ".join(f"{k} {v}%" for k, v in value.items())
            elif isinstance(value, list):
                display = ", ".join(value)
            elif isinstance(value, float) and key.endswith("_pct"):
                display = f"{value}%"
            else:
                display = str(value)
            index[key] = {"label": key.replace("_pct", " %").replace("_", " ").capitalize(), "display": display}
    return index


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def validate_report(summary: dict):
    allowed = set(summary["evidence_keys"])
    names = {a["name"] for a in summary["archetype_candidates"]}

    def check(data: dict) -> list[str]:
        problems = []
        for section in ["archetypes", "strengths", "development_areas", "training_translation"]:
            items = data.get(section)
            if not isinstance(items, list) or not items:
                problems.append(f"'{section}' must be a non-empty list")
                continue
            for item in items:
                bad = [k for k in item.get("evidence", []) if k not in allowed]
                if bad:
                    problems.append(f"unknown evidence keys {bad} in {section}; use only evidence_keys")
                if not item.get("evidence"):
                    problems.append(f"an item in {section} has no evidence")
        for a in data.get("archetypes", []) if isinstance(data.get("archetypes"), list) else []:
            if a.get("name") not in names:
                problems.append(f"archetype '{a.get('name')}' is not one of the candidates {sorted(names)}")
        return problems
    return check


def generate(summary: dict, cache_only: bool = False) -> dict:
    system = SYSTEM_PROMPT + ("\n\n" + TIER1_NOTE if summary["data_tier"] == 1 else "")
    user = "Player summary:\n" + json.dumps(summary, ensure_ascii=False, indent=1)
    if cache_only:
        cached = llm.get_cached(llm.cache_key("report", system, user))
        return None if cached is None else {**cached, "cached": True}
    return llm.complete_json("report", system, user, REQUIRED, validate=validate_report(summary))
