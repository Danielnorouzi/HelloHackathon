"""Loads configuration from backend/.env so providers and keys can be swapped."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "anthropic").lower()
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL") or None

API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY", "")
API_FOOTBALL_BASE_URL = os.getenv("API_FOOTBALL_BASE_URL", "https://v3.football.api-sports.io")

OFFLINE_MODE = os.getenv("OFFLINE_MODE", "false").lower() == "true"

DATABASE_PATH = BACKEND_DIR / os.getenv("DATABASE_PATH", "data/soccer.db")
CONFIG_DIR = BACKEND_DIR / "config"

# --- Live Skills Coach -------------------------------------------------------
# Coaching data lives in its own SQLite file, separate from the player-analysis database.
COACH_DATABASE_PATH = BACKEND_DIR / os.getenv("COACH_DATABASE_PATH", "data/coach.db")
COACH_TTS_CACHE_DIR = BACKEND_DIR / os.getenv("COACH_TTS_CACHE_DIR", "data/coach_tts")
# Text model for spoken answers (short replies, so a fast model is best). Defaults to LLM_MODEL.
COACH_LLM_MODEL = os.getenv("COACH_LLM_MODEL") or LLM_MODEL

# Voice (speech-to-text + text-to-speech) uses an OpenAI-compatible audio API. By default it reuses
# the LLM key when LLM_PROVIDER=openai. Keys never leave the server.
VOICE_ENABLED = os.getenv("VOICE_ENABLED", "true").lower() == "true"
VOICE_API_KEY = os.getenv("VOICE_API_KEY") or (LLM_API_KEY if LLM_PROVIDER == "openai" else "")
VOICE_BASE_URL = os.getenv("VOICE_BASE_URL") or (LLM_BASE_URL if LLM_PROVIDER == "openai" else None)
VOICE_TTS_MODEL = os.getenv("VOICE_TTS_MODEL", "gpt-4o-mini-tts")
VOICE_TTS_VOICE = os.getenv("VOICE_TTS_VOICE", "coral")
VOICE_STT_MODEL = os.getenv("VOICE_STT_MODEL", "gpt-4o-mini-transcribe")
