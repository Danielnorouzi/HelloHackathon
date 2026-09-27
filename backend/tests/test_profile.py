"""Profile updates: display name, self-assessment (always labelled self-reported), and its use in plans."""
import pytest
from fastapi.testclient import TestClient

from app import plan, skills
from app.db import SessionLocal, UserProfile
from app.main import app

client = TestClient(app)
TESTS = {"sprint_10m": 1.9, "sprint_30m": 4.5, "shooting_accuracy": 5, "wall_passes_right": 18, "slalom_time": 12.5}


@pytest.fixture(autouse=True)
def clean_profiles():
    def wipe():
        with SessionLocal() as db:
            db.query(UserProfile).delete()
            db.commit()
    wipe()
    yield
    wipe()


def profile_rows():
    with SessionLocal() as db:
        return db.query(UserProfile).count()


def save(**extra):
    body = {"name": "Dani", "age": 19, "position_group": "MID", "results": TESTS, **extra}
    return client.post("/api/me", json=body)


# ---------------------------------------------------------------------------
# Display name
# ---------------------------------------------------------------------------

def test_rename_updates_the_profile_in_place():
    save()
    rows = profile_rows()
    r = client.patch("/api/me", json={"name": "  Dani   Norouzi "})
    assert r.status_code == 200 and r.json()["name"] == "Dani Norouzi"
    assert client.get("/api/me").json()["name"] == "Dani Norouzi"
    assert profile_rows() == rows                                   # no new row
    assert r.json()["card"]["ovr"] == save().json()["card"]["ovr"]  # card untouched by a rename


def test_rename_rejects_blank_or_too_long_names():
    save()
    assert client.patch("/api/me", json={"name": "   "}).status_code == 422
    assert client.patch("/api/me", json={"name": ""}).status_code == 422
    assert client.patch("/api/me", json={"name": "x" * 41}).status_code == 422
    assert client.get("/api/me").json()["name"] == "Dani"


def test_rename_without_a_profile_is_a_clear_404():
    r = client.patch("/api/me", json={"name": "Someone"})
    assert r.status_code == 404 and "No profile yet" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Self-assessment
# ---------------------------------------------------------------------------

def test_self_assessment_fills_def_and_phy_as_self_reported_not_measured():
    without = save().json()["card"]
    answers = {"stamina": 4, "strength": 3, "one_v_one": 2, "tackling": 4, "reading": 3}
    card = save(self_assessment=answers).json()["card"]
    scores = skills.self_assessment_config()["option_scores"]
    assert card["attributes"]["PHY"] == {**card["attributes"]["PHY"], "source": "self_reported", "value": round((scores[3] + scores[2]) / 2)}
    assert card["attributes"]["DEF"]["value"] == round((scores[1] + scores[3] + scores[2]) / 3)
    assert card["attributes"]["DEF"]["note"] == "Self-reported from your answers, not measured."
    assert card["attributes"]["PAC"]["source"] == "measured"
    assert card["ovr"] == without["ovr"]                         # not part of OVR
    assert card["confidence"]["score"] == without["confidence"]["score"]
    assert "self-reported" in card["ovr_note"]


def test_one_answer_is_not_enough_to_rate_an_area():
    card = save(self_assessment={"stamina": 5}).json()["card"]
    assert card["attributes"]["PHY"]["value"] is None
    assert "Answer at least 2" in card["attributes"]["PHY"]["note"]


def test_questionnaire_only_profile_is_allowed_and_answers_are_validated():
    assert save(results={}, self_assessment={"stamina": 3, "recovery": 2}).status_code == 200
    assert save(self_assessment={"stamina": 6}).status_code == 400
    assert save(self_assessment={"not_a_question": 1}).status_code == 400
    assert save(results={}, self_assessment={}).status_code == 400


def test_compare_labels_self_reported_values():
    card = save(self_assessment={"one_v_one": 4, "tackling": 4}).json()["card"]
    target = {"attributes": {c: {"value": 70, "source": "measured", "note": None} for c in ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"]}}
    target["attributes"]["PHY"] = {"value": None, "source": "unavailable", "note": "N/A: requires tracking data"}
    gaps = {g["attribute"]: g for g in skills.compare(card, target)}
    assert gaps["DEF"]["user_source"] == "self_reported" and gaps["DEF"]["gap"] == 70 - card["attributes"]["DEF"]["value"]
    assert gaps["PHY"]["gap"] is None and gaps["PHY"]["target_source"] == "unavailable"


def test_plans_get_physical_context_only_when_answered():
    assert plan.physical_context({"self_assessment": {}}) == {}
    ctx = plan.physical_context({"self_assessment": {"stamina": 1, "recovery": 5, "aerial": 3}})
    assert ctx["physical_self_assessment"]["stamina"] == "Under 10 minutes"
    assert "aerial" not in ctx["physical_self_assessment"] and "not measured" in ctx["physical_self_assessment"]["note"]
