"""SQLite schema (SQLAlchemy). Every table the app uses is defined here.

Tables
- matches        one row per StatsBomb match we preloaded
- players        one row per StatsBomb player
- player_matches minutes played + primary position per player per match
- events         slimmed StatsBomb events (only the fields the app uses)
- player_map     manual link between StatsBomb and API-Football ids (demo players)
- api_cache      every API-Football response, keyed by endpoint + params
- llm_cache      every generated LLM report / plan, keyed by a hash of its input
- user_profiles  skill-test results entered by the user
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text, create_engine, Index,
)
from sqlalchemy.orm import declarative_base, sessionmaker

from app.settings import DATABASE_PATH

DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{DATABASE_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


def utcnow():
    return datetime.now(timezone.utc)


class Match(Base):
    __tablename__ = "matches"
    match_id = Column(Integer, primary_key=True)
    competition_id = Column(Integer)
    competition_name = Column(String)
    season_id = Column(Integer)
    season_name = Column(String)
    match_date = Column(String)
    home_team = Column(String)
    away_team = Column(String)
    home_score = Column(Integer)
    away_score = Column(Integer)


class Player(Base):
    __tablename__ = "players"
    player_id = Column(Integer, primary_key=True)  # StatsBomb player id
    name = Column(String, index=True)
    nickname = Column(String)
    country = Column(String)


class PlayerMatch(Base):
    __tablename__ = "player_matches"
    match_id = Column(Integer, primary_key=True)
    player_id = Column(Integer, primary_key=True)
    team = Column(String)
    minutes = Column(Float)           # minutes on the pitch, from lineups + substitutions
    position = Column(String)         # StatsBomb position where they spent the most minutes
    started = Column(Boolean)


class Event(Base):
    __tablename__ = "events"
    event_id = Column(String, primary_key=True)
    match_id = Column(Integer)
    period = Column(Integer)
    minute = Column(Integer)
    second = Column(Integer)
    team = Column(String)
    player_id = Column(Integer)
    player = Column(String)
    position = Column(String)
    type = Column(String)
    play_pattern = Column(String)
    x = Column(Float)                 # StatsBomb pitch: 120 x 80, attacking left -> right
    y = Column(Float)
    end_x = Column(Float)             # pass / carry / shot end location
    end_y = Column(Float)
    under_pressure = Column(Boolean)
    pass_recipient_id = Column(Integer)
    pass_recipient = Column(String)
    pass_outcome = Column(String)     # NULL means completed (StatsBomb convention)
    pass_height = Column(String)
    pass_type = Column(String)        # Corner, Free Kick, Throw-in, ... NULL = open play
    pass_shot_assist = Column(Boolean)  # key pass
    pass_goal_assist = Column(Boolean)
    pass_cross = Column(Boolean)
    pass_through_ball = Column(Boolean)
    body_part = Column(String)        # pass or shot body part
    dribble_outcome = Column(String)
    shot_xg = Column(Float)
    shot_outcome = Column(String)
    shot_type = Column(String)        # Open Play, Penalty, Free Kick, Corner
    duel_type = Column(String)
    duel_outcome = Column(String)
    interception_outcome = Column(String)
    counterpress = Column(Boolean)


# Composite indexes: most queries ask for one player's events of a few types.
Index("ix_events_player_type", Event.player_id, Event.type)
Index("ix_events_match", Event.match_id)
Index("ix_events_recipient_type", Event.pass_recipient_id, Event.type)


class PlayerMap(Base):
    __tablename__ = "player_map"
    id = Column(Integer, primary_key=True, autoincrement=True)
    display_name = Column(String)
    statsbomb_id = Column(Integer, nullable=True)
    api_football_id = Column(Integer, nullable=True)
    birth_date = Column(String)
    team = Column(String)
    position_group = Column(String)
    is_demo = Column(Boolean, default=False)


class ApiCache(Base):
    __tablename__ = "api_cache"
    cache_key = Column(String, primary_key=True)   # endpoint + sorted params
    response_json = Column(Text)
    fetched_at = Column(DateTime, default=utcnow)


class LlmCache(Base):
    __tablename__ = "llm_cache"
    cache_key = Column(String, primary_key=True)   # kind + sha256 of the input JSON
    kind = Column(String)                          # "report" or "plan"
    model = Column(String)
    response_json = Column(Text)
    created_at = Column(DateTime, default=utcnow)


class UserProfile(Base):
    __tablename__ = "user_profiles"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String)
    age = Column(Integer)
    level = Column(String)
    tests_json = Column(Text)                      # raw skill-test results
    created_at = Column(DateTime, default=utcnow)


def init_db():
    Base.metadata.create_all(engine)
    # create_all skips indexes on tables that already exist, so add any missing ones explicitly.
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            for index in table.indexes:
                index.create(conn, checkfirst=True)
