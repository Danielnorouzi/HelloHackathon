"""Tier 1 players: season totals from API-Football (no event data).

- Search: API-Football player profiles, merged under our StatsBomb results. Demo players that are
  mapped to an API-Football id (player_map table) are shown once, as Tier 2.
- Profile: the season's main competition (most minutes), converted to per 90. Percentiles use the
  same StatsBomb comparison pool, which is only a rough guide because the providers define stats
  differently; the card's confidence is capped accordingly (config/rating.json).
"""
import pandas as pd

from app import api_football, metrics, players, rating

SEASON = 2024   # the free plan covers this season (checked with a live request)
POSITION_GROUPS = {"Attacker": "FWD", "Midfielder": "MID", "Defender": "DEF", "Goalkeeper": "GK"}
# Tier 1 stats that exist in the StatsBomb pool too, so they get a (rough) percentile.
COMPARABLE = ["non_penalty_goals", "shots", "shots_on_target_pct", "assists", "key_passes",
              "successful_dribbles", "dribble_success_pct", "tackles_won", "interceptions"]


def mapped_api_ids() -> dict[int, int]:
    """API-Football id -> StatsBomb id for manually mapped (demo) players."""
    demo = players.demo_map()
    demo = demo[demo.api_football_id.notna() & demo.statsbomb_id.notna()]
    return {int(r.api_football_id): int(r.statsbomb_id) for r in demo.itertuples()}


def cached_profiles() -> list[dict]:
    """Every player profile from API-Football searches already in the cache (free to reuse)."""
    import json
    from app.db import ApiCache, SessionLocal
    with SessionLocal() as db:
        rows = db.query(ApiCache.response_json).filter(ApiCache.cache_key.like("players/profiles?%")).all()
    seen, out = set(), []
    for (raw,) in rows:
        for item in json.loads(raw).get("response", []):
            if item["player"]["id"] not in seen:
                seen.add(item["player"]["id"])
                out.append(item)
    return out


def search(q: str, allow_network: bool) -> list[dict]:
    """Tier 1 search. Without network: match names across all cached searches.
    With network (>= 3 characters): one API-Football request for this query, cached forever."""
    q = q.strip().lower()
    if allow_network:
        if len(q) < 3:
            return []
        data = api_football.get("players/profiles", {"search": q}, allow_network=True)
        items = data.get("response", []) if data else []
    else:
        items = [i for i in cached_profiles()
                 if q in f"{i['player']['name']} {i['player'].get('firstname') or ''} {i['player'].get('lastname') or ''}".lower()]
    mapped = mapped_api_ids()
    out = []
    for item in items:
        p = item["player"]
        if p["id"] in mapped:
            continue  # already shown as the Tier 2 (StatsBomb) version
        out.append({
            "key": f"af-{p['id']}", "name": p["name"], "full_name": f"{p.get('firstname') or ''} {p.get('lastname') or ''}".strip(),
            "team": p.get("nationality"), "position": p.get("position"), "tier": 1, "is_demo": False,
            "age": p.get("age"),
        })
    return out


def season_stats(api_id: int) -> tuple[dict, dict]:
    """(player info, main-competition statistics) for SEASON. Raises KeyError if unavailable."""
    data = api_football.get("players", {"id": api_id, "season": SEASON})
    if not data or not data.get("response"):
        raise KeyError(api_id)
    item = data["response"][0]
    rows = [s for s in item["statistics"] if (s["games"]["minutes"] or 0) > 0]
    if not rows:
        raise KeyError(api_id)
    main = max(rows, key=lambda s: s["games"]["minutes"] or 0)
    return item["player"], main


def _n(value) -> float | None:
    """API-Football uses null for stats it has no value for. Keep that as missing (None):
    only real numbers (including real zeros) are values."""
    return float(value) if isinstance(value, (int, float)) else None


def _per90(total, minutes):
    return total / minutes * 90 if total is not None and minutes else None


def _rate(part, whole, min_whole):
    return part / whole * 100 if part is not None and whole is not None and whole >= min_whole else None


def stat_rows(main: dict, group: str) -> list[dict]:
    """Per-90 stats in the same shape as metrics.stat_rows (so the table and card can reuse them).
    A stat is None when API-Football has no value for it, never silently 0."""
    minutes = _n(main["games"]["minutes"])
    shots, on_target = _n(main["shots"]["total"]), _n(main["shots"]["on"])
    dribbles, dribbles_won = _n(main["dribbles"]["attempts"]), _n(main["dribbles"]["success"])
    goals, pens = _n(main["goals"]["total"]), _n(main["penalty"]["scored"])
    npg = goals - (pens or 0) if goals is not None else None       # no penalty entry = no penalty goals
    assists, key = _n(main["goals"]["assists"]), _n(main["passes"]["key"])
    tackles, interceptions = _n(main["tackles"]["total"]), _n(main["tackles"]["interceptions"])
    values = {
        "non_penalty_goals": (_per90(npg, minutes), npg),
        "shots": (_per90(shots, minutes), shots),
        "shots_on_target_pct": (_rate(on_target, shots, 10), None),
        "assists": (_per90(assists, minutes), assists),
        "key_passes": (_per90(key, minutes), key),
        "successful_dribbles": (_per90(dribbles_won, minutes), dribbles_won),
        "dribble_success_pct": (_rate(dribbles_won, dribbles, 10), None),
        "tackles_won": (_per90(tackles, minutes), tackles),
        "interceptions": (_per90(interceptions, minutes), interceptions),
    }
    pool = metrics.comparison_pool(players.season_table(), group)
    rows = []
    for key in COMPARABLE:
        value, total = values[key]
        meta = metrics.STATS[key]
        label = meta["label"] + (" (tackles made)" if key == "tackles_won" else "")
        rows.append({
            "key": key, "label": label, "kind": meta["kind"],
            "value": None if value is None else round(value, 2),
            "total": None if total is None else int(total),
            "percentile": metrics.percentile(value, pool[metrics.stat_column(key)]) if group in ("FWD", "MID", "DEF") else None,
        })
    return rows


def profile(api_id: int) -> dict:
    info, main = season_stats(api_id)
    group = POSITION_GROUPS.get(main["games"]["position"], "MID")
    pool = metrics.comparison_pool(players.season_table(), group)
    minutes = int(main["games"]["minutes"])
    season_label = f"{main['league']['name']} {SEASON}/{str(SEASON + 1)[-2:]}"
    return {
        "key": f"af-{api_id}",
        "name": info["name"],
        "full_name": f"{info.get('firstname') or ''} {info.get('lastname') or ''}".strip(),
        "tier": 1,
        "is_demo": False,
        "scope": str(SEASON),
        "scope_label": season_label,
        "team": main["team"]["name"],
        "position": main["games"]["position"],
        "position_group": group,
        "position_group_name": metrics.GROUP_NAMES.get(group, group),
        "preferred_foot": {"foot": None, "share": None, "sample": 0},
        "minutes": minutes,
        "matches": int(main["games"]["appearences"] or 0),
        "age": info.get("age"),
        "nationality": info.get("nationality"),
        "seasons": [{"scope": str(SEASON), "label": season_label, "minutes": minutes, "team": main["team"]["name"]}],
        "pool": {"group": group, "size": len(pool), "min_minutes": metrics.MIN_MINUTES},
        "stats": stat_rows(main, group),
        "source_note": "Season totals from API-Football. Percentiles compare against the StatsBomb pool; "
                       "the two providers define some stats differently, so treat them as rough.",
    }


def card(api_id: int) -> dict:
    p = profile(api_id)
    return {"name": p["name"], "team": p["team"], "scope_label": p["scope_label"],
            "card": rating.build_card(p["stats"], p["position_group"], p["minutes"], tier=1)}


def summary(api_id: int) -> dict:
    """Report input for a Tier 1 player: totals and rough percentiles only."""
    from app.report import evidence_keys, suggest_archetypes   # local import: report imports players
    p = profile(api_id)
    summary = {
        "data_tier": 1,
        "player": {"name": p["name"], "position": p["position"], "position_group": p["position_group_name"],
                   "team": p["team"], "scope": p["scope_label"], "minutes": p["minutes"], "matches": p["matches"]},
        "comparison_pool": f"{p['pool']['size']} {p['position_group_name'].lower()} player-seasons from StatsBomb "
                           f"Open Data (different provider: percentiles are rough)",
        "definitions": {"per 90": "total divided by minutes played, times 90"},
        "stats": [{"key": s["key"], "label": s["label"], "value": s["value"], "percentile": s["percentile"],
                   "unit": "per 90" if s["kind"] == "p90" else "%"} for s in p["stats"]],
        "zones": {}, "patterns": {},
        "archetype_candidates": suggest_archetypes(p["stats"], {}, p["position_group"]),
    }
    summary["evidence_keys"] = evidence_keys(summary)
    return summary
