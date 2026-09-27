"""API-Football client (Tier 1 players). Every response is cached in SQLite, forever.

The free tier allows 100 requests/day, so:
- a request is sent at most once: the cache key is the endpoint + sorted params;
- we stop at DAILY_BUDGET requests per UTC day (counted from the cache timestamps), leaving headroom;
- OFFLINE_MODE=true, or no key, means cache only.
"""
import json
from datetime import datetime, timezone

import requests

from app import settings
from app.db import ApiCache, SessionLocal

DAILY_BUDGET = 90
TIMEOUT = 20


class ApiFootballError(Exception):
    pass


def cache_key(endpoint: str, params: dict) -> str:
    return endpoint + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))


def requests_today() -> int:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    with SessionLocal() as db:
        return db.query(ApiCache).filter(ApiCache.fetched_at >= start).count()


def get(endpoint: str, params: dict, allow_network: bool = True) -> dict | None:
    """Cached GET. Returns the parsed JSON, or None if it isn't cached and we may not fetch it."""
    key = cache_key(endpoint, params)
    with SessionLocal() as db:
        row = db.get(ApiCache, key)
        if row is not None:
            return json.loads(row.response_json)

    if not allow_network or settings.OFFLINE_MODE or not settings.API_FOOTBALL_KEY:
        return None
    if requests_today() >= DAILY_BUDGET:
        raise ApiFootballError(f"Daily API-Football budget reached ({DAILY_BUDGET} requests). Try again tomorrow.")

    try:
        resp = requests.get(f"{settings.API_FOOTBALL_BASE_URL}/{endpoint}", params=params,
                            headers={"x-apisports-key": settings.API_FOOTBALL_KEY}, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ApiFootballError("Couldn't reach API-Football.") from exc
    data = resp.json()
    errors = data.get("errors")
    if resp.status_code != 200 or (errors and errors != []):
        # Errors are not cached, so a fixed problem (e.g. a bad key) can be retried.
        raise ApiFootballError(f"API-Football error: {errors or resp.status_code}")

    with SessionLocal() as db:
        db.merge(ApiCache(cache_key=key, response_json=json.dumps(data)))
        db.commit()
    return data
