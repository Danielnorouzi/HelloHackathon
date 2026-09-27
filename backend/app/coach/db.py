"""Coach storage: a separate SQLite database with its own SQLAlchemy Base.

Only session summaries and per-attempt measurements are stored. No video, images or audio.
Nothing here references the player-analysis tables.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.settings import COACH_DATABASE_PATH

COACH_DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
coach_engine = create_engine(f"sqlite:///{COACH_DATABASE_PATH}", connect_args={"check_same_thread": False})
CoachSessionLocal = sessionmaker(bind=coach_engine)
CoachBase = declarative_base()


def utcnow():
    return datetime.now(timezone.utc)


class CoachSession(CoachBase):
    __tablename__ = "coach_sessions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    skill = Column(String, nullable=False)            # "shooting" | "dribbling"
    kicking_foot = Column(String)                     # "auto" | "left" | "right"
    source = Column(String)                           # "camera" | "file"
    started_at = Column(DateTime, default=utcnow)
    ended_at = Column(DateTime)
    attempts_count = Column(Integer, default=0)
    summary_json = Column(Text)


class CoachAttempt(CoachBase):
    __tablename__ = "coach_attempts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("coach_sessions.id"), index=True, nullable=False)
    idx = Column(Integer)
    measurements_json = Column(Text)                  # {key: {value, conf, reason}}
    quality_json = Column(Text)                       # tracking confidence for this attempt


def init_coach_db():
    CoachBase.metadata.create_all(coach_engine)
