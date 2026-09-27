"""Test setup: every test run uses throwaway databases and no API keys.

The environment must be set before any app module is imported (settings are read at import time).
python-dotenv never overrides variables that are already set, so backend/.env can't leak in.
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="soccerscout-tests-")
os.environ["DATABASE_PATH"] = os.path.join(_TMP, "analysis.db")
os.environ["COACH_DATABASE_PATH"] = os.path.join(_TMP, "coach.db")
os.environ["COACH_TTS_CACHE_DIR"] = os.path.join(_TMP, "tts")
os.environ["LLM_API_KEY"] = ""
os.environ["VOICE_API_KEY"] = ""
os.environ["API_FOOTBALL_KEY"] = ""
os.environ["OFFLINE_MODE"] = "false"
