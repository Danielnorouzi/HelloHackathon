"""End-of-session summary, built deterministically from the per-attempt measurements.

Strengths   = measurements in the target range on most of the attempts where they were measured.
Corrections = cues that fired on repeated attempts, with the typical measured value as evidence.
Limitations = why some measurements were withheld (ball not visible, camera angle, ...), plus what
              the app never measures (power, speed, accuracy).
"""
import json
from collections import Counter
from functools import lru_cache
from statistics import median

from app.coach import rules as coach_rules
from app.settings import CONFIG_DIR

MAX_DRILLS = 2


@lru_cache(maxsize=1)
def drill_catalog() -> dict:
    return json.loads((CONFIG_DIR / "coach_drills.json").read_text(encoding="utf-8"))["drills"]


def suggest_drills(corrections: list[dict], defs: dict, tracking_limited: bool) -> tuple[list[dict], str | None]:
    """One or two drills for the corrections that actually repeated (most important first).
    Each explains why it was chosen, citing the measured evidence. No corrections: no drills."""
    catalog = drill_catalog()
    chosen, names = [], set()
    for c in corrections:
        drill = catalog.get(c["key"])
        if not drill or drill["name"] in names:
            continue
        names.add(drill["name"])
        chosen.append({**drill, "for": c["key"],
                       "because": f"{defs[c['measure']]['label']}: {c['evidence']}"})
        if len(chosen) == MAX_DRILLS:
            break
    if chosen:
        return chosen, None
    if tracking_limited:
        return [], "No drill this time: tracking was too limited to find a repeated issue. Fix the camera setup first."
    return [], "No issue repeated in what could be measured, so there's no targeted drill this time."

NOT_MEASURED = {
    "shooting": "Shot power, ball speed and accuracy were not measured. That needs a calibrated camera and a visible target.",
    "dribbling": "Dribbling speed and distance weren't measured (no camera calibration). Only positions relative to your body were.",
}


def fmt_value(value: float, definition: dict) -> str:
    unit = definition["unit"]
    describe = definition.get("describe")
    if unit == "leg":
        text = f"{abs(value):.2f} leg lengths"
        if describe:
            text += " " + (describe["negative"] if value < 0 else describe["positive"])
        return text
    if unit == "deg":
        if describe:
            return f"{abs(value):.0f}° " + (describe["negative"] if value < 0 else describe["positive"])
        return f"{value:.0f}°"
    if unit == "pct":
        return f"{value:.0f}%"
    if unit == "per_s":
        return f"{value:.1f} per second"
    return f"{value:g}"


def summarize(skill: str, attempts: list[dict]) -> dict:
    cfg = coach_rules.skill_rules(skill)
    tracking = coach_rules.rules()["tracking"]
    defs = cfg["measurements"]
    noun = cfg["attempt_noun"]
    n = len(attempts)

    evaluations = [coach_rules.evaluate(skill, a.get("measurements", {})) for a in attempts]

    # Strengths: measured on >= 2 attempts and in range on >= 60% of them.
    strengths = []
    for key, d in defs.items():
        values = [a["measurements"][key]["value"] for a in attempts
                  if coach_rules.usable(a.get("measurements", {}).get(key), d["unit"])]
        if len(values) < 2:
            continue
        in_range = sum(coach_rules.in_good_range(v, d["good"]) for v in values)
        if in_range / len(values) >= 0.6:
            strengths.append({"measure": key, "label": d["label"],
                              "text": f"{d['label']}: in the target range on {in_range} of {len(values)} {noun} "
                                      f"(typical: {fmt_value(median(values), d)})."})

    # Corrections: cues that repeat (or any cue when there were only a few attempts).
    counts = Counter(c["key"] for e in evaluations for c in e["corrections"])
    cue_by_key = {c["key"]: c for c in cfg["cues"]}
    corrections = []
    for key, count in counts.items():
        if count < 2 and n > 3:
            continue
        cue = cue_by_key[key]
        d = defs[cue["measure"]]
        values = [c["value"] for e in evaluations for c in e["corrections"] if c["key"] == key]
        measured = sum(coach_rules.usable(a.get("measurements", {}).get(cue["measure"]), d["unit"]) for a in attempts)
        corrections.append({
            "key": key, "measure": cue["measure"], "priority": cue["priority"], "count": count, "text": cue["text"],
            "evidence": f"Seen on {count} of {measured} {noun} where it could be measured "
                        f"(typical: {fmt_value(median(values), d)}).",
        })
    corrections.sort(key=lambda c: (-c["priority"], -c["count"]))

    # Limitations: withheld measurements, grouped by reason.
    reason_attempts: dict[str, set] = {}
    reason_measures: dict[str, set] = {}
    for i, e in enumerate(evaluations):
        for w in e["withheld"]:
            reason_attempts.setdefault(w["reason"], set()).add(i)
            reason_measures.setdefault(w["reason"], set()).add(defs[w["measure"]]["label"].lower())
    order = {r: i for i, r in enumerate(tracking["order"])}
    limitations = []
    for reason in sorted(reason_attempts, key=lambda r: order.get(r, 99)):
        label = tracking["labels"].get(reason, reason.replace("_", " ").capitalize())
        k = len(reason_attempts[reason])
        affected = ", ".join(sorted(reason_measures[reason]))
        limitations.append(f"{label} on {k} of {n} {noun}, so {affected} wasn't judged for those.")
    pose_scores = [a.get("quality", {}).get("pose") for a in attempts if a.get("quality", {}).get("pose") is not None]
    if pose_scores and sum(pose_scores) / len(pose_scores) < 0.7:
        limitations.append(f"Body tracking was patchy (average confidence {sum(pose_scores) / len(pose_scores):.0%}).")
    if n == 0:
        limitations.append(f"No complete {noun} were detected. Check the camera setup tips and try again.")
    limitations.append(NOT_MEASURED[skill])

    drills, drills_note = suggest_drills(corrections, defs, tracking_limited=bool(reason_attempts) or n == 0)
    return {
        "skill": skill,
        "attempts": n,
        "strengths": strengths,
        "corrections": corrections,
        "limitations": limitations,
        "drills": drills,
        "drills_note": drills_note,
    }
