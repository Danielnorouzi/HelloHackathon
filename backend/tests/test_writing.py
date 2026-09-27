"""House style: no em dashes in user-facing text (config text and AI output)."""
import json
from pathlib import Path

from app.text import plain_dashes

CONFIG = Path(__file__).resolve().parents[1] / "config"


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            if not k.startswith("_"):              # "_comment" keys are developer notes
                yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def test_config_text_has_no_em_dashes():
    offenders = [(f.name, s) for f in CONFIG.glob("*.json")
                 for s in strings(json.loads(f.read_text(encoding="utf-8"))) if "—" in s or " – " in s]
    assert offenders == []


def test_ai_text_dashes_become_normal_punctuation():
    assert plain_dashes("He drifts inside — often late — and shoots.") == "He drifts inside, often late, and shoots."
    assert plain_dashes("Strong on the ball—very strong.") == "Strong on the ball, very strong."
    assert plain_dashes("Pace – not measured.") == "Pace, not measured."
    assert plain_dashes("Rated 40–99 on the card.") == "Rated 40–99 on the card."        # number ranges kept
    assert plain_dashes({"a": ["x — y"], "n": 3}) == {"a": ["x, y"], "n": 3}
