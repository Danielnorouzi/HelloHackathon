"""The six player criteria (card attributes PAC, SHO, PAS, DRI, DEF, PHY): where each value comes from.

Every criterion value is recorded as one of:
  measured     computed from real source data (StatsBomb events, or API-Football season totals)
  imputed      no source value exists, so it is the median of VALID (measured) values for the same
               criterion: the player's position group if it has at least MIN_GROUP_VALID of them,
               otherwise all player-seasons
  unavailable  no source measures it AND no player has a valid value to take a median from

Rules: valid values (including real zeros) are never replaced; imputed values are never used as
inputs for other medians; nothing here adds rows (results are stored as columns of
player_season_stats by scripts/fill_criteria.py, which can be re-run safely).
"""
from functools import lru_cache
from statistics import median

CRITERIA = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"]
MIN_GROUP_VALID = 30          # a position median needs at least this many valid values
REFERENCE_MIN_MINUTES = 450   # medians use player-seasons with a reasonable sample

# Which sources can provide a real value for each criterion (checked before any imputation).
SOURCE_COVERAGE = {
    "PAC": [],
    "SHO": ["StatsBomb events (Tier 2)", "API-Football season totals (Tier 1, partial)"],
    "PAS": ["StatsBomb events (Tier 2)", "API-Football season totals (Tier 1, key passes only)"],
    "DRI": ["StatsBomb events (Tier 2)", "API-Football season totals (Tier 1, partial)"],
    "DEF": ["StatsBomb events (Tier 2)", "API-Football season totals (Tier 1, partial)"],
    "PHY": [],
}
NO_SOURCE_REASON = {
    "PAC": "No source measures pace: it needs tracking data. StatsBomb and API-Football have no speed fields.",
    "PHY": "No source measures physical output: it needs tracking data. API-Football only lists height and weight.",
}


def is_valid(value) -> bool:
    """A real number (zero included). None and NaN are missing."""
    return isinstance(value, (int, float)) and value == value


def compute_medians(records: list[dict], min_group_valid: int = MIN_GROUP_VALID) -> dict:
    """records: [{"group": "FWD", "values": {"SHO": 71, ...}, "sources": {"SHO": "measured", ...}}].
    Only measured, valid values count. Returns {"overall": {c: (median, n)}, "groups": {g: {c: (median, n)}}}."""
    overall, groups = {}, {}
    for c in CRITERIA:
        vals = [r["values"].get(c) for r in records
                if r.get("sources", {}).get(c, "measured") == "measured" and is_valid(r["values"].get(c))]
        overall[c] = (median(vals), len(vals)) if vals else (None, 0)
        for g in {r["group"] for r in records}:
            gv = [r["values"].get(c) for r in records if r["group"] == g
                  and r.get("sources", {}).get(c, "measured") == "measured" and is_valid(r["values"].get(c))]
            groups.setdefault(g, {})[c] = (median(gv), len(gv)) if gv else (None, 0)
    return {"overall": overall, "groups": groups, "min_group_valid": min_group_valid}


def fill_value(criterion: str, value, group: str, medians: dict) -> dict:
    """→ {"value", "source", "basis"} for one criterion of one player."""
    if is_valid(value):
        return {"value": value, "source": "measured", "basis": None}
    g_med, g_n = medians["groups"].get(group, {}).get(criterion, (None, 0))
    if g_med is not None and g_n >= medians["min_group_valid"]:
        return {"value": round(g_med), "source": "imputed",
                "basis": f"Median of {g_n} measured {group} player-seasons (no source value for this player)."}
    o_med, o_n = medians["overall"].get(criterion, (None, 0))
    if o_med is not None:
        return {"value": round(o_med), "source": "imputed",
                "basis": f"Overall median of {o_n} measured player-seasons ({group} had too few for a position median)."}
    reason = NO_SOURCE_REASON.get(criterion, "No source value, and no measured values to take a median from.")
    return {"value": None, "source": "unavailable", "basis": reason + " No player has a measured value to take a median from."}


# ---------------------------------------------------------------------------
# Runtime: medians from the stored, measured criteria (written by scripts/fill_criteria.py)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def stored_medians() -> dict | None:
    """Medians of measured criteria in player_season_stats, or None if the fill script hasn't run."""
    from app import players   # local import: players → rating → criteria
    table = players.season_table()
    if f"crit_{CRITERIA[0]}" not in table.columns:
        return None
    ref = table[table["minutes"] >= REFERENCE_MIN_MINUTES]
    records = [{"group": r["position_group"],
                "values": {c: r[f"crit_{c}"] for c in CRITERIA},
                "sources": {c: r[f"crit_{c}_source"] for c in CRITERIA}} for _, r in ref.iterrows()]
    return compute_medians(records)


def fill_card(card: dict, group: str) -> dict:
    """Fill a built card's missing criteria in place (and label them). Returns the card."""
    medians = stored_medians()
    imputed = []
    for c in CRITERIA:
        attr = card["attributes"][c]
        if is_valid(attr["value"]):
            attr["source"] = "measured"
            continue
        if medians is None:
            attr["source"] = "unavailable"
            attr["basis"] = NO_SOURCE_REASON.get(c, "Not measured for this player.")
            continue
        filled = fill_value(c, None, group, medians)
        attr["source"], attr["basis"] = filled["source"], filled["basis"]
        if filled["source"] == "imputed":
            attr["value"] = filled["value"]
            attr["note"] = "Imputed: " + filled["basis"]
            imputed.append(c)
    card["imputed"] = imputed
    return card
