"""House style for user-facing text: no em dashes.

AI-written text (reports, plans, coach answers) sometimes uses em dashes, and cached reports already
contain some. Instead of changing the prompts (which would invalidate every cached report), dashes
are rewritten as normal punctuation on the way out. Number ranges like "40–99" are left alone.
"""
import re

_SPACED_DASH = re.compile(r"\s*—\s*|\s+–\s+")   # em dash (any spacing) or a spaced en dash


def plain_dashes(value):
    """Rewrite dashes as commas in a string, or in every string inside a dict/list (returns a copy)."""
    if isinstance(value, str):
        text = _SPACED_DASH.sub(", ", value)
        return re.sub(r",\s*([.,;:!?])", r"\1", text)          # "word — ." edge cases
    if isinstance(value, dict):
        return {k: plain_dashes(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain_dashes(v) for v in value]
    return value
