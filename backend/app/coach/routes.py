"""Live Skills Coach API (mounted under /api/coach).

The browser does all computer vision. These endpoints only receive measurements and short
questions, and they read/write the separate coach database, never the player-analysis data.
"""
import json
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from app import llm, settings
from app.coach import assistant, voice
from app.coach import rules as coach_rules
from app.coach.db import CoachAttempt, CoachSession, CoachSessionLocal, init_coach_db, utcnow
from app.coach.summary import summarize

router = APIRouter(prefix="/api/coach", tags=["coach"])
init_coach_db()

MAX_ATTEMPTS = 300
MAX_AUDIO_BYTES = 4 * 1024 * 1024


class MeasureIn(BaseModel):
    value: float | None = None
    conf: float = Field(0.0, ge=0.0, le=1.0)
    reason: str | None = Field(None, max_length=40)


class ContactIn(BaseModel):
    """Which part of the boot met the ball (shooting), estimated in the browser."""
    zone: Literal["laces", "inside", "outside", "toe", "side"] | None = None
    target: Literal["laces", "inside", "outside"] | None = None
    conf: float = Field(0.0, ge=0.0, le=1.0)
    reason: str | None = Field(None, max_length=40)


class AttemptIn(BaseModel):
    measurements: dict[str, MeasureIn] = {}
    quality: dict[str, float | bool | str | None] = {}
    contact: ContactIn | None = None


class SessionStartIn(BaseModel):
    skill: Literal["shooting", "dribbling"]
    kicking_foot: Literal["auto", "left", "right"] = "auto"
    source: Literal["camera", "file"] = "camera"


class SessionEndIn(BaseModel):
    attempts: list[AttemptIn] = Field(default_factory=list, max_length=MAX_ATTEMPTS)


def clean_attempts(skill: str, attempts: list[AttemptIn]) -> list[dict]:
    """Keep only the measurement keys this skill defines, as plain dicts."""
    known = coach_rules.skill_rules(skill)["measurements"].keys()
    return [{"measurements": {k: m.model_dump() for k, m in a.measurements.items() if k in known},
             "quality": {k: v for k, v in a.quality.items() if isinstance(v, (int, float, bool)) or v is None},
             "contact": a.contact.model_dump() if a.contact and skill == "shooting" else None}
            for a in attempts]


@router.get("/status")
def status():
    """What the coach can do right now. Tracking and on-screen cues always work in the browser."""
    return {
        "llm": llm.llm_available(),
        "tts": voice.tts_available(),
        "stt": voice.stt_available(),
        "offline": settings.OFFLINE_MODE,
        "voice_name": settings.VOICE_TTS_VOICE if voice.tts_available() else None,
    }


@router.post("/sessions")
def start_session(body: SessionStartIn):
    with CoachSessionLocal() as db:
        row = CoachSession(skill=body.skill, kicking_foot=body.kicking_foot, source=body.source)
        db.add(row)
        db.commit()
        return {"session_id": row.id, "skill": row.skill}


@router.post("/sessions/{session_id}/end")
def end_session(session_id: int, body: SessionEndIn, narrate: bool = True):
    with CoachSessionLocal() as db:
        row = db.get(CoachSession, session_id)
        if row is None:
            raise HTTPException(404, "Coaching session not found")
        if row.ended_at is not None:
            return json.loads(row.summary_json)
        attempts = clean_attempts(row.skill, body.attempts)
        summary = summarize(row.skill, attempts)
        summary["narrative"] = assistant.narrative(summary) if narrate and attempts else None
        for i, a in enumerate(attempts):
            db.add(CoachAttempt(session_id=row.id, idx=i, measurements_json=json.dumps(a["measurements"]),
                                quality_json=json.dumps({**a["quality"], "contact": a["contact"]})))
        row.ended_at = utcnow()
        row.attempts_count = len(attempts)
        row.summary_json = json.dumps(summary)
        db.commit()
        return summary


@router.get("/sessions/{session_id}")
def get_session(session_id: int):
    with CoachSessionLocal() as db:
        row = db.get(CoachSession, session_id)
        if row is None:
            raise HTTPException(404, "Coaching session not found")
        return {"session_id": row.id, "skill": row.skill, "attempts": row.attempts_count,
                "ended": row.ended_at is not None,
                "summary": json.loads(row.summary_json) if row.summary_json else None}


@router.post("/ask")
async def ask(
    skill: Literal["shooting", "dribbling"] = Form(...),
    attempts_json: str = Form("[]"),
    question: str = Form("", max_length=400),
    audio: UploadFile | None = File(None),
):
    """Answer a question about the session. Spoken questions are transcribed on the server and not stored."""
    try:
        attempts_in = TypeAdapter(list[AttemptIn]).validate_json(attempts_json)
    except ValidationError:
        raise HTTPException(400, "attempts_json is not valid")
    attempts = clean_attempts(skill, attempts_in[-MAX_ATTEMPTS:])

    transcript = None
    if audio is not None:
        data = await audio.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "That recording is too long. Keep questions short.")
        try:
            transcript = voice.transcribe(data, audio.filename or "question.webm", audio.content_type or "audio/webm")
        except voice.VoiceUnavailable as exc:
            raise HTTPException(503, str(exc))
    text = (transcript or question).strip()
    if not text:
        raise HTTPException(400, "I didn't catch a question. Try again or type it.")

    summary = summarize(skill, attempts) if len(attempts) >= 2 else None
    result = assistant.answer(text, skill, attempts, summary)
    return {"question": text, "transcribed": transcript is not None, **result}


@router.get("/tts")
def tts(text: str = Query(..., min_length=1, max_length=400), cache: bool = True):
    """Streamed MP3 speech for a cue or answer (GET so an <audio> element can play it while it
    downloads). 503 means: use the browser's own voice instead."""
    try:
        stream = voice.speech_stream(text.strip(), cache=cache)
    except voice.VoiceUnavailable as exc:
        raise HTTPException(503, str(exc))
    return StreamingResponse(stream, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
