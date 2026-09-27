"""Server-side copy of the live rules: reads config/coach_rules.json (the same file the browser uses).

The server never trusts cue lists sent by the browser; it re-derives them from the measurements.
"""
import json
import math
from functools import lru_cache

from app.settings import CONFIG_DIR

SKILLS = ("shooting", "dribbling")
# Plausible bounds for incoming measurements; anything outside is treated as a tracking glitch.
BOUNDS = {"leg": (-6.0, 6.0), "deg": (-180.0, 180.0), "pct": (0.0, 100.0), "per_s": (0.0, 20.0), "count": (0.0, 100.0)}


@lru_cache(maxsize=1)
def rules() -> dict:
    return json.loads((CONFIG_DIR / "coach_rules.json").read_text(encoding="utf-8"))


def skill_rules(skill: str) -> dict:
    return rules()["skills"][skill]


def usable(measure: dict | None, unit: str) -> bool:
    """A measurement can support a correction only if it exists, is plausible, and is confident."""
    if not measure or measure.get("value") is None:
        return False
    value = measure["value"]
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return False
    lo, hi = BOUNDS.get(unit, (-1e9, 1e9))
    if not lo <= value <= hi:
        return False
    return (measure.get("conf") or 0) >= rules()["confidence"]["measurement_min"]


def in_good_range(value: float, good: list) -> bool:
    return good[0] <= value <= good[1]


def evaluate(skill: str, measurements: dict) -> dict:
    """Same logic as frontend/src/coach/rules.js: corrections, good measures, withheld measures."""
    cfg = skill_rules(skill)
    defs = cfg["measurements"]
    corrections, good, withheld = [], [], []
    for key, d in defs.items():
        m = measurements.get(key)
        if usable(m, d["unit"]):
            if in_good_range(m["value"], d["good"]):
                good.append(key)
        elif m is not None:
            withheld.append({"measure": key, "reason": m.get("reason") or "low_confidence"})
    for cue in cfg["cues"]:
        m = measurements.get(cue["measure"])
        if not usable(m, defs[cue["measure"]]["unit"]):
            continue
        value = m["value"]
        if ("below" in cue and value < cue["below"]) or ("above" in cue and value > cue["above"]):
            corrections.append({"key": cue["key"], "measure": cue["measure"], "priority": cue["priority"],
                                "text": cue["text"], "value": value})
    corrections.sort(key=lambda c: -c["priority"])
    return {"corrections": corrections, "good": good, "withheld": withheld}
