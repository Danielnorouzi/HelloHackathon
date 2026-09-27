"""User skill tests: benchmark conversion, the user's card, and user-vs-pro comparison.

Each test result is placed on the benchmark table for the user's age group (config/benchmarks.json):
the Beginner/Intermediate/Advanced/Elite values map to fixed scores (50/65/78/90), results in between
are interpolated, and results outside are extrapolated from the nearest two levels, clamped to 40-99.
"""
import json
from functools import lru_cache

import numpy as np

from app.db import SessionLocal, UserProfile
from app.settings import CONFIG_DIR

EVIDENCE_NOTE = ("Different kinds of evidence: the pro's card comes from percentiles in real match data; "
                 "yours comes from self-recorded skill tests against age benchmarks. Use the gaps as a "
                 "training guide, not a like-for-like measurement.")


@lru_cache(maxsize=1)
def config() -> dict:
    return json.loads((CONFIG_DIR / "benchmarks.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def self_assessment_config() -> dict:
    return json.loads((CONFIG_DIR / "self_assessment.json").read_text(encoding="utf-8"))


def score_self_assessment(answers: dict | None) -> dict:
    """answers: {question_id: 1..5}. Returns {area: {value | None, evidence, answered}}. Self-reported only."""
    cfg = self_assessment_config()
    out = {}
    for area in cfg["areas"]:
        evidence = []
        for q in cfg["questions"]:
            a = (answers or {}).get(q["id"])
            if q["area"] == area and isinstance(a, int) and 1 <= a <= len(q["options"]):
                evidence.append({"key": q["id"], "label": q["text"], "display": "You answered: " + q["options"][a - 1],
                                 "score": cfg["option_scores"][a - 1], "percentile": None})
        enough = len(evidence) >= cfg["min_answers"]
        out[area] = {"value": round(sum(e["score"] for e in evidence) / len(evidence)) if enough else None,
                     "evidence": evidence, "answered": len(evidence)}
    return out


def age_group(age: int) -> str:
    for g in config()["age_groups"]:
        if age <= g["max_age"]:
            return g["id"]
    return "Adult"


def score_result(test: dict, value: float, group: str) -> dict:
    """Result -> {score 40-99, level label}. Lower-is-better tests are flipped so the maths is the same."""
    cfg = config()
    anchors = np.array(test["benchmarks"][group], dtype=float)
    scores = np.array(cfg["level_scores"], dtype=float)
    x = float(value)
    if test["better"] == "lower":
        anchors, x = -anchors, -x
    if x <= anchors[0]:          # below Beginner: extend the Beginner->Intermediate slope
        slope = (scores[1] - scores[0]) / (anchors[1] - anchors[0])
        score = scores[0] + (x - anchors[0]) * slope
    elif x >= anchors[-1]:       # above Elite: extend the Advanced->Elite slope
        slope = (scores[-1] - scores[-2]) / (anchors[-1] - anchors[-2])
        score = scores[-1] + (x - anchors[-1]) * slope
    else:
        score = float(np.interp(x, anchors, scores))
    score = int(round(min(max(score, cfg["scale_min"]), cfg["scale_max"])))
    reached = [lvl for lvl, a in zip(cfg["levels"], anchors) if x >= a]
    return {"score": score, "level": reached[-1] if reached else "Below beginner"}


def build_card(results: dict, age: int, position_group: str, self_assessment: dict | None = None) -> dict:
    """The user's card, in the same shape as rating.build_card so the UI can reuse it.
    PAC/SHO/PAS/DRI come from measured skill tests. DEF and PHY can come from the self-assessment:
    they are labelled self-reported and never count towards OVR or confidence."""
    cfg = config()
    group = age_group(age)
    tests = {t["id"]: t for t in cfg["tests"]}
    scored = {}
    for test_id, value in results.items():
        if test_id in tests and value is not None and value != "":
            scored[test_id] = {**score_result(tests[test_id], value, group), "value": float(value)}

    attributes = {}
    for code, attr in cfg["attributes"].items():
        if attr.get("unavailable"):
            attributes[code] = {"label": attr["label"], "value": None, "note": attr["unavailable"], "evidence": []}
            continue
        evidence = [{
            "key": t, "label": tests[t]["name"],
            "display": f"{scored[t]['value']:g} {tests[t]['unit']} · {scored[t]['level']}",
            "score": scored[t]["score"], "percentile": None,
        } for t in attr["tests"] if t in scored]
        values = [e["score"] for e in evidence]
        attributes[code] = {
            "label": attr["label"],
            "value": round(sum(values) / len(values)) if values else None,
            "note": None if values else "Test not entered",
            "source": "measured" if values else "unavailable",
            "evidence": evidence,
        }

    # Self-reported attributes (only where no test measures them).
    reported = score_self_assessment(self_assessment)
    self_reported = []
    min_answers = self_assessment_config()["min_answers"]
    for code, r in reported.items():
        current = attributes.get(code)
        if current is None or current.get("value") is not None:
            continue
        if r["value"] is not None:
            attributes[code] = {"label": current["label"], "value": r["value"], "source": "self_reported",
                                "note": "Self-reported from your answers, not measured.", "evidence": r["evidence"]}
            self_reported.append(code)
        else:
            current["source"] = "unavailable"
            if r["answered"]:
                current["note"] = f"Answer at least {min_answers} questions to rate this."

    weights = cfg["ovr_weights"].get(position_group, cfg["ovr_weights"]["MID"])
    parts = [(w, attributes[a]["value"]) for a, w in weights.items() if attributes[a]["value"] is not None]
    ovr = round(sum(w * v for w, v in parts) / sum(w for w, _ in parts)) if parts else None

    coverage = len(scored) / len(cfg["tests"])
    reasons = [cfg["confidence"]["reason"], f"{len(scored)} of {len(cfg['tests'])} tests entered.",
               f"Benchmarked against the {group} age group."]
    ovr_note = None
    if self_reported:
        listed = " and ".join(self_reported)
        reasons.append(f"{listed} come from your own answers (self-reported), so they don't affect this score.")
        ovr_note = f"OVR uses measured tests only. {listed} are self-reported and not included."
    return {
        "ovr": ovr, "ovr_note": ovr_note, "ovr_weights": weights, "position_group": position_group,
        "self_reported": self_reported,
        "attributes": attributes, "tier": None, "source": "skill_tests",
        "confidence": {"score": round(cfg["confidence"]["cap"] * coverage), "reasons": reasons},
        "tests": {t: {**scored[t], "name": tests[t]["name"], "unit": tests[t]["unit"]} for t in scored},
        "age_group": group,
    }


# ---------------------------------------------------------------------------
# Storage: one demo user; the latest saved profile is "me".
# ---------------------------------------------------------------------------

def save_profile(name: str, age: int, position_group: str, results: dict, self_assessment: dict | None = None) -> dict:
    with SessionLocal() as db:
        row = UserProfile(name=name, age=age, level=None, tests_json=json.dumps(
            {"position_group": position_group, "results": results, "self_assessment": self_assessment or {}}))
        db.add(row)
        db.commit()
    return load_profile()


def rename_profile(name: str) -> dict | None:
    """Change the display name on the current profile in place (no new row)."""
    with SessionLocal() as db:
        row = db.query(UserProfile).order_by(UserProfile.id.desc()).first()
        if row is None:
            return None
        row.name = name
        db.commit()
    return load_profile()


def load_profile() -> dict | None:
    with SessionLocal() as db:
        row = db.query(UserProfile).order_by(UserProfile.id.desc()).first()
        if row is None:
            return None
        data = json.loads(row.tests_json)
        answers = data.get("self_assessment") or {}
        return {"id": row.id, "name": row.name, "age": row.age, "position_group": data["position_group"],
                "results": data["results"], "self_assessment": answers, "created_at": row.created_at.isoformat(),
                "card": build_card(data["results"], row.age, data["position_group"], answers)}


def compare(user_card: dict, target_card: dict) -> list[dict]:
    """Per-attribute gap (target - user). Only where both sides have a number."""
    gaps = []
    for code in ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"]:
        u = user_card["attributes"][code]["value"]
        t = target_card["attributes"][code]["value"]
        gaps.append({"attribute": code, "label": user_card["attributes"][code]["label"], "user": u, "target": t,
                     "user_source": user_card["attributes"][code].get("source", "measured"),
                     "target_source": target_card["attributes"][code].get("source", "measured"),
                     "target_basis": target_card["attributes"][code].get("basis"),
                     "gap": None if u is None or t is None else t - u,
                     "note": None if (u is not None and t is not None) else
                     (target_card["attributes"][code]["note"] if t is None else user_card["attributes"][code]["note"])})
    return gaps
