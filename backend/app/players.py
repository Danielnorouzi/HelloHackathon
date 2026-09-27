"""Player data for the API: search, profile, and the data behind each pitch visual.

Player keys: "sb-<id>" = StatsBomb (Tier 2, full event data), "af-<id>" = API-Football (Tier 1).
Scopes: "all" = every season in the dataset, or "<competition_id>-<season_id>" for one season.
"""
import unicodedata
from functools import lru_cache

import numpy as np
import pandas as pd
from sqlalchemy import text

from app import metrics
from app.db import engine

PASS_MAP_LIMIT = 1500   # an SVG with more arrows than this is unreadable (and slow)
HEAT_BINS_X, HEAT_BINS_Y = 24, 16   # 5 x 5 yard cells on the 120 x 80 pitch


@lru_cache(maxsize=1)
def season_table() -> pd.DataFrame:
    """All player-seasons (built by scripts/build_metrics.py). Loaded once per process."""
    return pd.read_sql("SELECT * FROM player_season_stats", engine)


@lru_cache(maxsize=1)
def demo_map() -> pd.DataFrame:
    return pd.read_sql("SELECT * FROM player_map WHERE is_demo = 1", engine)


def display_name(row) -> str:
    return row["nickname"] if isinstance(row.get("nickname"), str) and row["nickname"] else row["name"]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def fold(text: str) -> str:
    """Lower-case and strip accents, so "modric" finds "Modrić"."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(ch)).lower()


@lru_cache(maxsize=1)
def careers() -> pd.DataFrame:
    """One row per player (no new data): totals plus team/position from their biggest season."""
    table = season_table()
    biggest = table.sort_values("minutes").groupby("player_id").tail(1).set_index("player_id")
    agg = table.groupby("player_id").agg(name=("name", "first"), nickname=("nickname", "first"),
                                         minutes=("minutes", "sum"), seasons=("season_name", "nunique"))
    out = agg.join(biggest[["team", "primary_position", "position_group"]]).reset_index()
    out["display"] = [n if isinstance(n, str) and n else full for n, full in zip(out["nickname"], out["name"])]
    out["search"] = [fold(f"{a or ''} {b or ''}") for a, b in zip(out["name"], out["nickname"])]
    demo_ids = set(demo_map()["statsbomb_id"].dropna().astype(int))
    out["is_demo"] = out["player_id"].isin(demo_ids)
    return out


def _player_row(h) -> dict:
    return {
        "key": f"sb-{int(h.player_id)}", "name": h.display, "full_name": h["name"], "team": h.team,
        "position": h.primary_position, "position_group": h.position_group, "tier": 2,
        "is_demo": bool(h.is_demo), "minutes": round(float(h.minutes)), "seasons": int(h.seasons),
    }


def search(q: str, limit: int = 10) -> list[dict]:
    """Autocomplete: StatsBomb players whose name or nickname contains q. Demo players first, then by minutes."""
    q = fold(q.strip())
    if len(q) < 2:
        return []
    c = careers()
    hits = c[c["search"].str.contains(q, regex=False)].sort_values(["is_demo", "minutes"], ascending=False).head(limit)
    return [_player_row(h) for _, h in hits.iterrows()]


LIST_SORTS = {"minutes": (["minutes"], [False]), "name": (["display"], [True]), "seasons": (["seasons", "minutes"], [False, False])}
MAX_PAGE_SIZE = 100


def list_players(q: str = "", group: str | None = None, sort: str = "minutes", page: int = 1, page_size: int = 25) -> dict:
    """Every player in the dataset, filtered, sorted and paginated (the Players tab)."""
    c = careers()
    if q.strip():
        c = c[c["search"].str.contains(fold(q.strip()), regex=False)]
    if group:
        c = c[c["position_group"] == group]
    cols, asc = LIST_SORTS.get(sort, LIST_SORTS["minutes"])
    c = c.sort_values(cols + ["player_id"], ascending=asc + [True])     # player_id: stable tie-break
    page_size = max(1, min(int(page_size), MAX_PAGE_SIZE))
    total = len(c)
    pages = max(1, -(-total // page_size))
    page = max(1, int(page))
    chunk = c.iloc[(page - 1) * page_size: page * page_size]
    return {"results": [_player_row(h) for _, h in chunk.iterrows()], "total": total,
            "page": page, "page_size": page_size, "pages": pages}


def featured() -> list[dict]:
    """Demo players for the home page."""
    out = []
    for _, d in demo_map().iterrows():
        if pd.notna(d.statsbomb_id):
            out.append({"key": f"sb-{int(d.statsbomb_id)}", "name": d.display_name, "team": d.team,
                        "position_group": d.position_group, "tier": 2, "is_demo": True})
    return out


# ---------------------------------------------------------------------------
# Scopes
# ---------------------------------------------------------------------------

def player_seasons(player_id: int) -> pd.DataFrame:
    t = season_table()
    return t[t.player_id == player_id].sort_values(["competition_id", "season_name"])


def default_scope(player_id: int) -> str:
    """The season with the most minutes: the richest sample for the first view."""
    best = player_seasons(player_id).sort_values("minutes").iloc[-1]
    return f"{int(best.competition_id)}-{int(best.season_id)}"


def scope_filter(scope: str) -> tuple[str, dict]:
    """SQL condition on the matches table (alias m) for a scope string."""
    if scope == "all":
        return "1 = 1", {}
    comp, season = (int(v) for v in scope.split("-"))
    return "m.competition_id = :comp AND m.season_id = :season", {"comp": comp, "season": season}


def scope_row(player_id: int, scope: str) -> pd.Series:
    """Aggregated stats for a player in a scope. Single seasons come from the prebuilt table;
    'all' is aggregated on the fly from the player's events."""
    if scope != "all":
        comp, season = (int(v) for v in scope.split("-"))
        seasons = player_seasons(player_id)
        return seasons[(seasons.competition_id == comp) & (seasons.season_id == season)].iloc[0]
    where = "e.player_id = :pid"
    ev = metrics.load_events(where, {"pid": player_id})
    mins = metrics.load_minutes("pm.player_id = :pid", {"pid": player_id})
    return metrics.aggregate(ev, mins, ["player_id"]).iloc[0]


def scope_label(row) -> str:
    return "All seasons" if "season_name" not in row or pd.isna(row.get("season_name")) \
        else f"{row['competition_name']} {row['season_name']}"


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

def events(player_id: int, scope: str, types: tuple[str, ...]) -> pd.DataFrame:
    where, params = scope_filter(scope)
    placeholders = ", ".join(f":t{i}" for i in range(len(types)))
    params.update({f"t{i}": t for i, t in enumerate(types)}, pid=player_id)
    sql = f"""SELECT e.*, m.match_date, m.home_team, m.away_team
              FROM events e JOIN matches m ON e.match_id = m.match_id
              WHERE e.player_id = :pid AND e.type IN ({placeholders}) AND {where}"""
    return pd.read_sql(text(sql), engine, params=params)


def preferred_foot(player_id: int, scope: str) -> dict:
    """Measured, not assumed: share of foot passes played with each foot."""
    passes = events(player_id, scope, ("Pass",))
    feet = passes["body_part"].value_counts()
    left, right = int(feet.get("Left Foot", 0)), int(feet.get("Right Foot", 0))
    if left + right == 0:
        return {"foot": None, "share": None, "sample": 0}
    foot = "Left" if left >= right else "Right"
    return {"foot": foot, "share": round(max(left, right) / (left + right) * 100), "sample": left + right}


def profile(player_id: int, scope: str | None = None) -> dict:
    seasons = player_seasons(player_id)
    if seasons.empty:
        raise KeyError(player_id)
    scope = scope or default_scope(player_id)
    row = scope_row(player_id, scope)
    group = row["position_group"]
    pool = metrics.comparison_pool(season_table(), group)
    first = seasons.iloc[0]
    demo = demo_map()
    demo_row = demo[demo.statsbomb_id == player_id]

    return {
        "key": f"sb-{player_id}",
        "name": demo_row.iloc[0].display_name if not demo_row.empty else display_name(first),
        "full_name": first["name"],
        "tier": 2,
        "is_demo": not demo_row.empty,
        "scope": scope,
        "scope_label": scope_label(row),
        "team": row["team"],
        "position": row["primary_position"],
        "position_group": group,
        "position_group_name": metrics.GROUP_NAMES.get(group, group),
        "preferred_foot": preferred_foot(player_id, scope),
        "minutes": round(float(row["minutes"])),
        "matches": int(row["matches"]),
        "seasons": [
            {"scope": f"{int(s.competition_id)}-{int(s.season_id)}",
             "label": f"{s.competition_name} {s.season_name}",
             "minutes": round(float(s.minutes)), "team": s.team}
            for _, s in seasons.iterrows()
        ],
        "pool": {"group": group, "size": len(pool), "min_minutes": metrics.MIN_MINUTES},
        "stats": metrics.stat_rows(row, pool),
    }


# ---------------------------------------------------------------------------
# Pitch visuals
# ---------------------------------------------------------------------------

def _clean(records: list[dict]) -> list[dict]:
    """NaN -> None so the JSON is valid."""
    return [{k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in r.items()} for r in records]


def pass_map(player_id: int, scope: str, filter_: str = "all") -> dict:
    ev = events(player_id, scope, ("Pass",))
    ev = ev[ev["pass_type"] != "Throw-in"].dropna(subset=["x", "end_x"])
    ev["completed"] = ev["pass_outcome"].isna()
    ev["progressive"] = ev["completed"] & (ev["pass_type"] != "Corner") & metrics.is_progressive(ev)
    ev["under_pressure"] = ev["under_pressure"].astype(bool)
    counts = {"all": len(ev), "progressive": int(ev["progressive"].sum()),
              "under_pressure": int(ev["under_pressure"].sum())}
    if filter_ == "progressive":
        ev = ev[ev["progressive"]]
    elif filter_ == "under_pressure":
        ev = ev[ev["under_pressure"]]

    total = len(ev)
    sampled = total > PASS_MAP_LIMIT
    if sampled:
        ev = ev.sample(PASS_MAP_LIMIT, random_state=0)  # fixed seed: same picture every time
    cols = ["x", "y", "end_x", "end_y", "completed", "progressive", "under_pressure", "pass_height", "body_part"]
    return {
        "filter": filter_, "counts": counts, "total": total, "shown": len(ev), "sampled": sampled,
        "completion_pct": round(float(ev["completed"].mean() * 100), 1) if len(ev) else None,
        "passes": _clean(ev[cols].round(1).to_dict("records")),
    }


def shot_map(player_id: int, scope: str) -> dict:
    ev = events(player_id, scope, ("Shot",)).dropna(subset=["x"])
    ev["is_goal"] = ev["shot_outcome"] == "Goal"
    ev["opponent"] = np.where(ev["team"] == ev["home_team"], ev["away_team"], ev["home_team"])
    cols = ["x", "y", "shot_xg", "shot_outcome", "shot_type", "body_part", "minute", "match_date",
            "opponent", "is_goal"]
    non_pen = ev[ev["shot_type"] != "Penalty"]
    return {
        "shots": _clean(ev[cols].round({"x": 1, "y": 1, "shot_xg": 3}).to_dict("records")),
        "summary": {
            "shots": len(ev), "goals": int(ev["is_goal"].sum()),
            "xg": round(float(ev["shot_xg"].sum()), 2),
            "np_shots": len(non_pen), "np_goals": int(non_pen["is_goal"].sum()),
            "npxg": round(float(non_pen["shot_xg"].sum()), 2),
        },
    }


def heat_map(player_id: int, scope: str) -> dict:
    """Counts of on-ball actions in 5x5-yard cells (rows = y bins, cols = x bins)."""
    ev = events(player_id, scope, tuple(metrics.HEATMAP_TYPES)).dropna(subset=["x", "y"])
    grid, _, _ = np.histogram2d(ev["y"].clip(0, 79.99), ev["x"].clip(0, 119.99),
                                bins=[HEAT_BINS_Y, HEAT_BINS_X], range=[[0, 80], [0, 120]])
    thirds = pd.cut(ev["x"], [0, 40, 80, 120], labels=["defensive", "middle", "attacking"], include_lowest=True)
    lanes = pd.cut(ev["y"], [0, 18, 62, 80], labels=["left", "central", "right"], include_lowest=True)
    return {
        "bins_x": HEAT_BINS_X, "bins_y": HEAT_BINS_Y, "grid": grid.astype(int).tolist(),
        "total": len(ev),
        "thirds_pct": (thirds.value_counts(normalize=True) * 100).round(1).to_dict(),
        "lanes_pct": (lanes.value_counts(normalize=True) * 100).round(1).to_dict(),
    }


def pass_network(player_id: int, scope: str, top: int = 5) -> dict:
    """Top teammates the player completes passes to, and receives completed passes from."""
    where, params = scope_filter(scope)
    params["pid"] = player_id
    to_sql = f"""SELECT e.pass_recipient_id AS player_id, e.pass_recipient AS name, COUNT(*) AS passes
                 FROM events e JOIN matches m ON e.match_id = m.match_id
                 WHERE e.player_id = :pid AND e.type = 'Pass' AND e.pass_outcome IS NULL
                   AND e.pass_recipient_id IS NOT NULL AND {where}
                 GROUP BY e.pass_recipient_id ORDER BY passes DESC LIMIT {top}"""
    from_sql = f"""SELECT e.player_id, e.player AS name, COUNT(*) AS passes
                   FROM events e JOIN matches m ON e.match_id = m.match_id
                   WHERE e.pass_recipient_id = :pid AND e.type = 'Pass' AND e.pass_outcome IS NULL AND {where}
                   GROUP BY e.player_id ORDER BY passes DESC LIMIT {top}"""
    to_df = pd.read_sql(text(to_sql), engine, params=params)
    from_df = pd.read_sql(text(from_sql), engine, params=params)

    # Average position of each teammate (where they made their on-ball actions) for the diagram.
    ids = sorted(set(to_df.player_id.astype(int)) | set(from_df.player_id.astype(int)) | {player_id})
    id_list = ", ".join(str(i) for i in ids)
    pos_sql = f"""SELECT e.player_id, AVG(e.x) AS x, AVG(e.y) AS y FROM events e
                  JOIN matches m ON e.match_id = m.match_id
                  WHERE e.player_id IN ({id_list}) AND e.type IN ('Pass', 'Ball Receipt*', 'Carry') AND {where}
                  GROUP BY e.player_id"""
    avg = pd.read_sql(text(pos_sql), engine, params={k: v for k, v in params.items() if k != "pid"})
    avg = avg.set_index("player_id").round(1)
    names = pd.read_sql(text(f"SELECT player_id, name, nickname FROM players WHERE player_id IN ({id_list})"),
                        engine).set_index("player_id")

    def node(pid, passes=None):
        n = names.loc[pid] if pid in names.index else None
        name = display_name(n) if n is not None else str(pid)
        p = avg.loc[pid] if pid in avg.index else None
        return {"key": f"sb-{pid}", "name": name, "passes": passes,
                "x": None if p is None else float(p.x), "y": None if p is None else float(p.y)}

    return {
        "player": node(player_id),
        "passes_to": [node(int(r.player_id), int(r.passes)) for r in to_df.itertuples()],
        "receives_from": [node(int(r.player_id), int(r.passes)) for r in from_df.itertuples()],
    }
