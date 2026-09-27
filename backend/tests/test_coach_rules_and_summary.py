"""Rule evaluation (shared cases with the browser) and the end-of-session summary."""
import json
from pathlib import Path

import pytest

from app.coach import rules as coach_rules
from app.coach.summary import summarize

CASES = json.loads((Path(__file__).parent / "fixtures" / "coach_rule_cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_rule_cases_match_shared_fixture(case):
    result = coach_rules.evaluate(case["skill"], case["measurements"])
    assert [c["key"] for c in result["corrections"]] == case["corrections"]
    assert sorted(result["good"]) == sorted(case["good"])
    assert result["withheld"] == case["withheld"]


def shot(plant=None, lean=None, follow=None, plant_reason=None, pose=0.9, conf=0.85):
    m = {}
    if plant is not None or plant_reason:
        m["plant_offset"] = {"value": plant, "conf": 0 if plant_reason else conf, "reason": plant_reason}
    if lean is not None:
        m["trunk_lean"] = {"value": lean, "conf": conf}
    if follow is not None:
        m["follow_through"] = {"value": follow, "conf": conf}
    return {"measurements": m, "quality": {"pose": pose}}


def test_summary_lists_repeated_correction_with_evidence():
    attempts = [shot(plant=-0.5, lean=8, follow=1.0), shot(plant=-0.45, lean=10, follow=1.1),
                shot(plant=0.0, lean=12, follow=0.9), shot(plant=-0.6, lean=9, follow=1.0)]
    s = summarize("shooting", attempts)
    assert [c["key"] for c in s["corrections"]] == ["plant_behind"]
    assert "3 of 4 shots" in s["corrections"][0]["evidence"]
    assert "behind the ball" in s["corrections"][0]["evidence"]
    assert {st["measure"] for st in s["strengths"]} == {"trunk_lean", "follow_through"}


def test_one_off_issue_is_not_a_correction_when_there_are_many_attempts():
    attempts = [shot(plant=-0.1, lean=-10)] + [shot(plant=-0.1, lean=10) for _ in range(5)]
    s = summarize("shooting", attempts)
    assert all(c["key"] != "leaning_back" for c in s["corrections"])


def test_withheld_measurements_become_limitations_not_judgements():
    attempts = [shot(plant_reason="ball_not_at_contact", lean=10), shot(plant_reason="ball_not_at_contact", lean=11),
                shot(plant=-0.9, lean=9, conf=0.2)]
    s = summarize("shooting", attempts)
    assert s["corrections"] == []                           # the -0.9 had low confidence, so no correction
    assert any("Ball not visible at contact on 2 of 3 shots" in lim for lim in s["limitations"])
    assert any("Low tracking confidence on 1 of 3 shots" in lim for lim in s["limitations"])


def test_summary_never_claims_power_speed_or_accuracy():
    s = summarize("shooting", [shot(plant=0.0, lean=10, follow=1.0)] * 3)
    text = json.dumps(s).lower()
    assert "not measured" in s["limitations"][-1].lower()
    for word in ["km/h", "mph", "m/s", "metres per", "accuracy:"]:
        assert word not in text


def test_patchy_tracking_and_no_attempts_are_reported():
    assert any("No complete runs" in lim for lim in summarize("dribbling", [])["limitations"])
    s = summarize("shooting", [shot(lean=10, pose=0.5), shot(lean=10, pose=0.6)])
    assert any("patchy" in lim for lim in s["limitations"])


# ---------------------------------------------------------------------------
# End-of-session drills
# ---------------------------------------------------------------------------

def test_drills_follow_the_observed_corrections_most_important_first():
    attempts = [shot(plant=-0.5, lean=-10, follow=0.3), shot(plant=-0.45, lean=-12, follow=0.3),
                shot(plant=-0.6, lean=-9, follow=0.2), shot(plant=-0.5, lean=-11, follow=0.25)]
    s = summarize("shooting", attempts)
    assert [c["key"] for c in s["corrections"]][:2] == ["plant_behind", "leaning_back"]
    assert len(s["drills"]) == 2                                    # never more than two
    assert [d["for"] for d in s["drills"]] == ["plant_behind", "leaning_back"]
    assert s["drills"][0]["name"] == "Plant-and-strike gates"
    assert "4 of 4 shots" in s["drills"][0]["because"] and "behind the ball" in s["drills"][0]["because"]
    assert s["drills"][0]["why"] and s["drills"][0]["needs"]
    assert s["drills_note"] is None


def test_same_drill_is_not_suggested_twice():
    # plant_behind and plant_ahead share a drill; the second slot goes to a different one.
    attempts = [shot(plant=-0.5, follow=0.3), shot(plant=0.5, follow=0.3), shot(plant=-0.6, follow=0.2), shot(plant=0.6, follow=0.3)]
    names = [d["name"] for d in summarize("shooting", attempts)["drills"]]
    assert len(names) == len(set(names))


def test_no_drill_without_a_repeated_issue():
    s = summarize("shooting", [shot(plant=0.0, lean=10, follow=1.0)] * 4)
    assert s["drills"] == [] and "No issue repeated" in s["drills_note"]


def test_no_drill_when_tracking_was_too_limited():
    s = summarize("shooting", [shot(plant_reason="ball_not_at_contact", lean=None)] * 3)
    assert s["drills"] == [] and "camera setup" in s["drills_note"]
