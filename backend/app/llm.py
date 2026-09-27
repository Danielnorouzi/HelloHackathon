"""LLM access: one function that returns parsed JSON, with caching and error handling.

Provider, model and key come from .env (LLM_PROVIDER = "openai" or "anthropic"), so they can be
swapped without code changes. Every successful response is cached in the llm_cache table, keyed by
a hash of (kind, model, prompts): the same request is never sent twice, and the demo can run
offline from the cache (OFFLINE_MODE=true never calls the API).
"""
import hashlib
import json
import re

from app import settings
from app.db import LlmCache, SessionLocal

MAX_ATTEMPTS = 2   # one retry if the reply isn't valid JSON or misses required keys


class LlmError(Exception):
    """Raised with a user-friendly message when a report or plan can't be produced."""


def cache_key(kind: str, system: str, user: str) -> str:
    digest = hashlib.sha256(f"{settings.LLM_MODEL}\n{system}\n{user}".encode("utf-8")).hexdigest()
    return f"{kind}:{digest}"


def get_cached(key: str):
    with SessionLocal() as db:
        row = db.get(LlmCache, key)
        if row is None:
            return None
        return {"data": json.loads(row.response_json), "model": row.model, "created_at": row.created_at.isoformat()}


def _save(key: str, kind: str, data: dict):
    with SessionLocal() as db:
        db.merge(LlmCache(cache_key=key, kind=kind, model=settings.LLM_MODEL, response_json=json.dumps(data)))
        db.commit()


def _call(system: str, messages: list[dict], json_mode: bool = True, model: str | None = None,
          max_tokens: int = 8000) -> str:
    """Send one request to the configured provider and return the raw text reply.
    json_mode=False is used by the Live Skills Coach for short spoken answers."""
    model = model or settings.LLM_MODEL
    if settings.LLM_PROVIDER == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=settings.LLM_API_KEY, base_url=settings.LLM_BASE_URL)
        reply = client.messages.create(model=model, max_tokens=max_tokens, system=system, messages=messages)
        return "".join(block.text for block in reply.content if block.type == "text")

    import openai  # "openai" and any OpenAI-compatible endpoint (set LLM_BASE_URL)
    client = openai.OpenAI(api_key=settings.LLM_API_KEY, base_url=settings.LLM_BASE_URL)
    reply = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, *messages],
        **({"response_format": {"type": "json_object"}} if json_mode else {}),
    )
    return reply.choices[0].message.content or ""


def llm_available() -> bool:
    return bool(settings.LLM_API_KEY) and not settings.OFFLINE_MODE


def complete_text(system: str, user: str, model: str | None = None) -> str:
    """Plain-text reply, NOT cached (used for live coaching answers, which are one-off)."""
    if not llm_available():
        raise LlmError("The AI coach isn't configured (no LLM_API_KEY, or offline mode).")
    try:
        return _call(system, [{"role": "user", "content": user}], json_mode=False, model=model,
                     max_tokens=600).strip()
    except Exception as exc:
        raise LlmError(f"The AI provider returned an error ({type(exc).__name__}).") from exc


def parse_json(text: str) -> dict:
    """Parse a JSON object from a model reply, tolerating ```json fences or text around it."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])   # raises if still invalid
        raise


def complete_json(kind: str, system: str, user: str, required_keys: list[str], validate=None) -> dict:
    """Return {"data", "model", "created_at", "cached"} for a JSON-producing prompt.

    validate(data) may return a list of problems; they're sent back to the model for one retry.
    """
    key = cache_key(kind, system, user)
    cached = get_cached(key)
    if cached:
        return {**cached, "cached": True}
    if settings.OFFLINE_MODE:
        raise LlmError("Offline mode: this report hasn't been generated and cached yet.")
    if not settings.LLM_API_KEY:
        raise LlmError("No LLM_API_KEY in backend/.env, so new reports can't be generated.")

    messages = [{"role": "user", "content": user}]
    problems = []
    for _ in range(MAX_ATTEMPTS):
        try:
            text = _call(system, messages)
        except Exception as exc:  # network, auth, rate limit: surface a clear message
            raise LlmError(f"The AI provider returned an error ({type(exc).__name__}). Try again in a moment.") from exc
        try:
            data = parse_json(text)
            problems = [f"missing key '{k}'" for k in required_keys if k not in data]
            if not problems and validate:
                problems = validate(data)
        except (json.JSONDecodeError, ValueError):
            problems = ["the reply was not valid JSON"]
        if not problems:
            _save(key, kind, data)
            return {"data": data, "model": settings.LLM_MODEL, "created_at": None, "cached": False}
        # Ask for a corrected version, showing what was wrong.
        messages += [{"role": "assistant", "content": text},
                     {"role": "user", "content": "Your reply had problems: " + "; ".join(problems)
                      + ". Reply again with the complete corrected JSON object only."}]
    raise LlmError("The AI reply couldn't be used (" + "; ".join(problems) + "). Please try again.")
