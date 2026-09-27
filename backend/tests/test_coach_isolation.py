"""Live coaching must not read or write player-analysis data, and must work without AI keys."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app import llm, settings
from app.coach import assistant
from app.coach.db import CoachBase, coach_engine
from app.db import Base, LlmCache, Player, SessionLocal, engine
from app.main import app

client = TestClient(app)
ANALYSIS_TABLES = sorted(Base.metadata.tables)


def analysis_snapshot() -> dict:
    """Row count and content fingerprint of every analysis table."""
    snap = {}
    with engine.connect() as conn:
        for table in ANALYSIS_TABLES:
            rows = conn.execute(text(f"SELECT * FROM {table}")).fetchall()
            snap[table] = (len(rows), hash(tuple(sorted(map(repr, rows)))))
    return snap


@pytest.fixture(autouse=True)
def seeded_analysis_data():
    with SessionLocal() as db:
        if db.get(Player, 5503) is None:
            db.add(Player(player_id=5503, name="Lionel Messi", nickname="Lionel Messi", country="Argentina"))
            db.add(LlmCache(cache_key="report:abc", kind="report", model="m", response_json="{}"))
            db.commit()
    yield


def test_coach_tables_live_in_their_own_database():
    assert set(CoachBase.metadata.tables) == {"coach_sessions", "coach_attempts"}
    assert not set(CoachBase.metadata.tables) & set(Base.metadata.tables)
    assert settings.COACH_DATABASE_PATH != settings.DATABASE_PATH
    assert set(inspect(coach_engine).get_table_names()) == {"coach_sessions", "coach_attempts"}
    assert not {"coach_sessions", "coach_attempts"} & set(inspect(engine).get_table_names())


def test_full_coaching_flow_leaves_analysis_data_untouched():
    before = analysis_snapshot()
    sid = client.post("/api/coach/sessions", json={"skill": "shooting", "kicking_foot": "right"}).json()["session_id"]
    attempts = [{"measurements": {"plant_offset": {"value": -0.5, "conf": 0.8}, "trunk_lean": {"value": 9, "conf": 0.9},
                                  "not_a_real_measure": {"value": 1, "conf": 1}}, "quality": {"pose": 0.9}}] * 3
    asked = client.post("/api/coach/ask", data={"skill": "shooting", "question": "How was my plant foot?",
                                                "attempts_json": json.dumps(attempts)})
    assert asked.status_code == 200
    ended = client.post(f"/api/coach/sessions/{sid}/end", json={"attempts": attempts})
    assert ended.status_code == 200
    assert ended.json()["corrections"][0]["key"] == "plant_behind"

    assert analysis_snapshot() == before           # no analysis table, cache or profile changed
    with coach_engine.connect() as conn:
        stored = conn.execute(text("SELECT measurements_json FROM coach_attempts")).fetchall()
    assert stored and all("not_a_real_measure" not in row[0] for row in stored)   # unknown keys are dropped


def test_existing_analysis_endpoints_are_unchanged():
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/me").status_code == 404                       # user profile is separate from coaching
    config = client.get("/api/skills/config").json()                    # skill-test benchmarks are byte-for-byte the file
    assert config == json.loads((settings.CONFIG_DIR / "benchmarks.json").read_text(encoding="utf-8"))


def test_works_without_any_ai_or_voice_keys():
    status = client.get("/api/coach/status").json()
    assert status == {"llm": False, "tts": False, "stt": False, "offline": False, "voice_name": None}
    assert client.get("/api/coach/tts", params={"text": "Plant your foot"}).status_code == 503   # browser voice takes over
    attempts = [{"measurements": {"trunk_lean": {"value": -12, "conf": 0.9}}}]
    r = client.post("/api/coach/ask", data={"skill": "shooting", "question": "Any tips?",
                                            "attempts_json": json.dumps(attempts)}).json()
    assert r["source"] == "rules" and "Lean over the ball" in r["answer"]


def test_ai_answers_are_grounded_filtered_and_not_cached(monkeypatch):
    seen = {}

    def fake_complete_text(system, user, model=None):
        seen["user"] = user
        return "Your standing foot was 0.50 leg lengths behind the ball. That shot left at 72 km/h. Step in beside it."
    monkeypatch.setattr(llm, "complete_text", fake_complete_text)
    with SessionLocal() as db:
        cached_before = db.query(LlmCache).count()

    attempts = [{"measurements": {"plant_offset": {"value": -0.5, "conf": 0.8},
                                  "trunk_lean": {"value": None, "conf": 0, "reason": "low_pose"}}}]
    r = client.post("/api/coach/ask", data={"skill": "shooting", "question": "How fast was it?",
                                            "attempts_json": json.dumps(attempts)}).json()
    assert r["source"] == "ai"
    assert "km/h" not in r["answer"] and "behind the ball" in r["answer"]      # invented speed removed
    assert "withheld (body partly hidden)" in seen["user"]                      # model is told what's missing
    assert "Shot power, ball speed and accuracy were not measured" in seen["user"]
    with SessionLocal() as db:
        assert db.query(LlmCache).count() == cached_before                      # coaching never touches llm_cache


def test_filter_unmeasured_keeps_legit_sentences():
    kept = assistant.filter_unmeasured("Lean forward 10 degrees more. It flew 20 metres. Nice follow-through!")
    assert kept == "Lean forward 10 degrees more. Nice follow-through!"


def test_bad_input_is_rejected():
    assert client.post("/api/coach/sessions", json={"skill": "juggling"}).status_code == 422
    assert client.post("/api/coach/sessions/999999/end", json={"attempts": []}).status_code == 404
    bad = [{"measurements": {"plant_offset": {"value": 0.1, "conf": 7}}}]
    assert client.post("/api/coach/ask", data={"skill": "shooting", "question": "hi",
                                               "attempts_json": json.dumps(bad)}).status_code == 400


def test_contact_area_is_stored_and_given_to_the_ai_coach(monkeypatch):
    seen = {}

    def fake_complete_text(system, user, model=None):
        seen["user"] = user
        return "Use your laces next time."
    monkeypatch.setattr(llm, "complete_text", fake_complete_text)
    attempts = [{"measurements": {}, "contact": {"zone": "toe", "target": "laces", "conf": 0.7}}]
    client.post("/api/coach/ask", data={"skill": "shooting", "question": "What did I hit it with?",
                                        "attempts_json": json.dumps(attempts)})
    assert "Contact area (estimated): toe, target laces (not the target, confidence 70%)" in seen["user"]

    sid = client.post("/api/coach/sessions", json={"skill": "shooting"}).json()["session_id"]
    r = client.post(f"/api/coach/sessions/{sid}/end", json={"attempts": attempts * 2}).json()
    assert r["contact"]["zones"] == {"toe": 2}
    with coach_engine.connect() as conn:
        stored = conn.execute(text("SELECT quality_json FROM coach_attempts WHERE session_id = :s"), {"s": sid}).fetchall()
    assert all(json.loads(row[0])["contact"]["zone"] == "toe" for row in stored)

    bad = [{"measurements": {}, "contact": {"zone": "heel", "target": "laces", "conf": 0.7}}]
    assert client.post(f"/api/coach/sessions/{sid}/end", json={"attempts": bad}).status_code == 422
