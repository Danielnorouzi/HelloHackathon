"""Metrics module: per-90 stats, progressive actions, and position percentiles.

Unit of analysis
- A "player-season" = one player in one competition-season (e.g. Messi, La Liga 2014/15).
- The comparison pool for percentiles = every player-season in the same position group with
  at least MIN_MINUTES minutes. Career views (all seasons combined) are ranked against that
  same pool, which works because every stat is expressed per 90 or as a rate.

Definitions (also shown in the UI tooltips)
- Progressive pass: a completed pass that moves the ball at least 10 m closer to the centre of
  the opponent's goal, or any completed pass into the penalty box, excluding passes that start
  in the player's own defensive third. Throw-ins are excluded, and corners don't count as progressive.
- Progressive carry: same distance rule applied to carries.
- Per 90: total / minutes played x 90.
- Percentile: share of the comparison pool this value beats (ties count half).
- Touch: a pass, shot, dribble, ball recovery, interception, clearance, miscontrol or dispossession.
- Possession-adjusted (PAdj) defending: each defensive action is multiplied by 50% / opponent possession
  in that match (capped to x0.5..x2), so players on dominant teams aren't penalised for having fewer
  chances to defend. Possession is estimated from each team's share of the match's passes.

StatsBomb coordinates are 120 x 80 yards, attacking left -> right, so 10 m = 10.94 units.
"""
from functools import lru_cache

import numpy as np
import pandas as pd
from sqlalchemy import text

from app.db import engine

MIN_MINUTES = 450
TEN_METRES = 10.94            # in StatsBomb units (yards)
GOAL_X, GOAL_Y = 120.0, 40.0  # centre of the opponent's goal
DEF_THIRD_X = 40.0            # own defensive third = x < 40
BOX_X, BOX_Y_MIN, BOX_Y_MAX = 102.0, 18.0, 62.0

POSITION_GROUPS = {
    "Goalkeeper": "GK",
    "Center Back": "DEF", "Left Center Back": "DEF", "Right Center Back": "DEF",
    "Left Back": "DEF", "Right Back": "DEF", "Left Wing Back": "DEF", "Right Wing Back": "DEF",
    "Center Defensive Midfield": "MID", "Left Defensive Midfield": "MID", "Right Defensive Midfield": "MID",
    "Center Midfield": "MID", "Left Center Midfield": "MID", "Right Center Midfield": "MID",
    "Left Midfield": "MID", "Right Midfield": "MID",
    "Center Attacking Midfield": "MID", "Left Attacking Midfield": "MID", "Right Attacking Midfield": "MID",
    "Left Wing": "FWD", "Right Wing": "FWD", "Center Forward": "FWD",
    "Left Center Forward": "FWD", "Right Center Forward": "FWD", "Secondary Striker": "FWD",
}
GROUP_NAMES = {"GK": "Goalkeepers", "DEF": "Defenders", "MID": "Midfielders", "FWD": "Forwards"}

# Every stat the app shows. kind: "p90" = per-90 rate, "pct" = a percentage, "ratio" = a plain rate.
STATS = {
    "non_penalty_goals": {"label": "Non-penalty goals", "kind": "p90"},
    "npxg":              {"label": "Non-penalty xG", "kind": "p90"},
    "shots":             {"label": "Shots", "kind": "p90"},
    "shots_on_target_pct": {"label": "Shots on target %", "kind": "pct"},
    "npxg_per_shot":     {"label": "xG per shot", "kind": "ratio"},
    "assists":           {"label": "Assists", "kind": "p90"},
    "key_passes":        {"label": "Key passes", "kind": "p90"},
    "passes_completed":  {"label": "Passes completed", "kind": "p90"},
    "pass_completion_pct": {"label": "Pass completion %", "kind": "pct"},
    "progressive_passes": {"label": "Progressive passes", "kind": "p90"},
    "passes_into_box":   {"label": "Passes into the box", "kind": "p90"},
    "successful_dribbles": {"label": "Successful dribbles", "kind": "p90"},
    "dribble_success_pct": {"label": "Dribble success %", "kind": "pct"},
    "progressive_carries": {"label": "Progressive carries", "kind": "p90"},
    "touches":           {"label": "Touches", "kind": "p90"},
    "touches_in_box":    {"label": "Touches in the box", "kind": "p90"},
    "tackles_won":       {"label": "Tackles won", "kind": "p90"},
    "interceptions":     {"label": "Interceptions", "kind": "p90"},
    "pressures":         {"label": "Pressures", "kind": "p90"},
    "ball_recoveries":   {"label": "Ball recoveries", "kind": "p90"},
    "tackles_won_padj":  {"label": "Tackles won (PAdj)", "kind": "p90"},
    "interceptions_padj": {"label": "Interceptions (PAdj)", "kind": "p90"},
    "pressures_padj":    {"label": "Pressures (PAdj)", "kind": "p90"},
    "ball_recoveries_padj": {"label": "Ball recoveries (PAdj)", "kind": "p90"},
}
PADJ_MIN, PADJ_MAX = 0.5, 2.0

# Rates need a minimum sample, otherwise 1 shot on target out of 1 = 100%.
RATE_MIN_ATTEMPTS = {"shots_on_target_pct": ("shots", 10), "npxg_per_shot": ("shots", 10),
                     "pass_completion_pct": ("passes", 50), "dribble_success_pct": ("dribbles", 10)}

ON_TARGET = {"Goal", "Saved", "Saved to Post"}
WON = {"Won", "Success", "Success In Play", "Success Out"}
# Touches (Opta-style): each ball action counted once. Receptions and carries are left out,
# otherwise "receive, carry, pass" would count as three touches.
TOUCH_TYPES = {"Pass", "Shot", "Dribble", "Miscontrol", "Dispossessed", "Ball Recovery", "Interception", "Clearance"}
# The heat map shows every on-ball event, including where the player receives and carries the ball.
HEATMAP_TYPES = TOUCH_TYPES | {"Ball Receipt*", "Carry"}

EVENT_COLUMNS = ("e.match_id, e.player_id, e.team, e.type, e.x, e.y, e.end_x, e.end_y, e.pass_outcome, "
                 "e.pass_type, e.pass_shot_assist, e.pass_goal_assist, e.dribble_outcome, e.shot_xg, "
                 "e.shot_outcome, e.shot_type, e.duel_type, e.duel_outcome")


# ---------------------------------------------------------------------------
# Event-level flags
# ---------------------------------------------------------------------------

def in_box(x, y):
    return (x >= BOX_X) & (y >= BOX_Y_MIN) & (y <= BOX_Y_MAX)


def is_progressive(ev: pd.DataFrame) -> pd.Series:
    """True for passes/carries that meet the progressive rule (completion is checked by the caller)."""
    before = np.hypot(GOAL_X - ev["x"], GOAL_Y - ev["y"])
    after = np.hypot(GOAL_X - ev["end_x"], GOAL_Y - ev["end_y"])
    closer = (before - after) >= TEN_METRES
    into_box = in_box(ev["end_x"], ev["end_y"]) & ~in_box(ev["x"], ev["y"])
    return (ev["x"] >= DEF_THIRD_X) & (closer | into_box)


def add_flags(ev: pd.DataFrame) -> pd.DataFrame:
    """Add one boolean column per countable action. Works on any slice of the events table."""
    ev = ev.copy()
    is_pass = (ev["type"] == "Pass") & (ev["pass_type"] != "Throw-in")
    completed = is_pass & ev["pass_outcome"].isna()
    shot = ev["type"] == "Shot"
    penalty = shot & (ev["shot_type"] == "Penalty")

    ev["f_pass"] = is_pass
    ev["f_pass_completed"] = completed
    not_corner = ev["pass_type"] != "Corner"   # a corner into the box isn't a progression
    ev["f_progressive_pass"] = completed & not_corner & is_progressive(ev)
    ev["f_pass_into_box"] = completed & not_corner & in_box(ev["end_x"], ev["end_y"]) & ~in_box(ev["x"], ev["y"])
    ev["f_key_pass"] = is_pass & (ev["pass_shot_assist"].astype(bool) | ev["pass_goal_assist"].astype(bool))
    ev["f_assist"] = is_pass & ev["pass_goal_assist"].astype(bool)

    ev["f_shot"] = shot & ~penalty
    ev["f_shot_on_target"] = ev["f_shot"] & ev["shot_outcome"].isin(ON_TARGET)
    ev["f_npg"] = ev["f_shot"] & (ev["shot_outcome"] == "Goal")
    ev["f_goal"] = shot & (ev["shot_outcome"] == "Goal")
    ev["npxg"] = np.where(ev["f_shot"], ev["shot_xg"].fillna(0), 0.0)

    ev["f_dribble"] = ev["type"] == "Dribble"
    ev["f_dribble_won"] = ev["f_dribble"] & (ev["dribble_outcome"] == "Complete")
    ev["f_progressive_carry"] = (ev["type"] == "Carry") & is_progressive(ev)

    ev["f_touch"] = ev["type"].isin(TOUCH_TYPES)
    ev["f_touch_in_box"] = ev["f_touch"] & in_box(ev["x"], ev["y"])

    ev["f_tackle_won"] = (ev["type"] == "Duel") & (ev["duel_type"] == "Tackle") & ev["duel_outcome"].isin(WON)
    ev["f_interception"] = ev["type"] == "Interception"
    ev["f_pressure"] = ev["type"] == "Pressure"
    ev["f_recovery"] = ev["type"] == "Ball Recovery"

    # Possession-adjusted versions of the defensive counts (see module docstring).
    weight = possession_weights(ev)
    for flag in ["f_tackle_won", "f_interception", "f_pressure", "f_recovery"]:
        ev[f"{flag}_padj"] = ev[flag] * weight
    return ev


@lru_cache(maxsize=1)
def possession_table() -> pd.DataFrame:
    """Each team's share of passes in each match (built by build_possession_table)."""
    return pd.read_sql("SELECT match_id, team, pass_share FROM team_match_possession", engine)


def build_possession_table() -> pd.DataFrame:
    sql = "SELECT match_id, team, COUNT(*) AS passes FROM events WHERE type = 'Pass' GROUP BY match_id, team"
    df = pd.read_sql(sql, engine)
    df["pass_share"] = df["passes"] / df.groupby("match_id")["passes"].transform("sum")
    return df


def possession_weights(ev: pd.DataFrame) -> pd.Series:
    """Multiplier per event = 0.5 / opponent possession, capped to [PADJ_MIN, PADJ_MAX]."""
    share = ev[["match_id", "team"]].merge(possession_table(), on=["match_id", "team"], how="left")["pass_share"]
    opponent = (1 - share.fillna(0.5)).clip(lower=0.05)
    return pd.Series((0.5 / opponent).clip(PADJ_MIN, PADJ_MAX).to_numpy(), index=ev.index)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def aggregate(ev: pd.DataFrame, minutes: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """Totals, per-90s and rates for each group of `keys` (e.g. player_id + season).

    ev: events with a player_id column (plus the key columns); minutes: player_matches rows.
    """
    ev = add_flags(ev)
    t = ev.groupby(keys).agg(
        passes=("f_pass", "sum"), passes_completed=("f_pass_completed", "sum"),
        progressive_passes=("f_progressive_pass", "sum"), passes_into_box=("f_pass_into_box", "sum"),
        key_passes=("f_key_pass", "sum"), assists=("f_assist", "sum"),
        shots=("f_shot", "sum"), shots_on_target=("f_shot_on_target", "sum"),
        non_penalty_goals=("f_npg", "sum"), goals=("f_goal", "sum"), npxg=("npxg", "sum"),
        dribbles=("f_dribble", "sum"), successful_dribbles=("f_dribble_won", "sum"),
        progressive_carries=("f_progressive_carry", "sum"),
        touches=("f_touch", "sum"), touches_in_box=("f_touch_in_box", "sum"),
        tackles_won=("f_tackle_won", "sum"), interceptions=("f_interception", "sum"),
        pressures=("f_pressure", "sum"), ball_recoveries=("f_recovery", "sum"),
        tackles_won_padj=("f_tackle_won_padj", "sum"), interceptions_padj=("f_interception_padj", "sum"),
        pressures_padj=("f_pressure_padj", "sum"), ball_recoveries_padj=("f_recovery_padj", "sum"),
    )
    mins = minutes.groupby(keys).agg(minutes=("minutes", "sum"), matches=("match_id", "nunique"))
    t = mins.join(t, how="left").fillna(0)

    # Position group = the group where the player spent most minutes in this scope.
    grp = minutes.assign(group=minutes["position"].map(POSITION_GROUPS))
    grp = grp.groupby(keys + ["group"])["minutes"].sum().reset_index()
    grp = grp.sort_values("minutes").groupby(keys).tail(1).set_index(keys)["group"]
    pos = minutes.groupby(keys + ["position"])["minutes"].sum().reset_index()
    pos = pos.sort_values("minutes").groupby(keys).tail(1).set_index(keys)["position"]
    team = minutes.groupby(keys + ["team"])["minutes"].sum().reset_index()
    team = team.sort_values("minutes").groupby(keys).tail(1).set_index(keys)["team"]
    t["position_group"] = grp
    t["primary_position"] = pos
    t["team"] = team
    return add_rates(t.reset_index())


def add_rates(t: pd.DataFrame) -> pd.DataFrame:
    """Per-90 columns (<stat>_p90) and percentage / ratio stats."""
    t = t.copy()
    for stat, meta in STATS.items():
        if meta["kind"] == "p90":
            t[f"{stat}_p90"] = np.where(t["minutes"] > 0, t[stat] / t["minutes"] * 90, np.nan)

    def safe_div(a, b):
        return np.where(t[b] > 0, t[a] / t[b].replace(0, np.nan), np.nan)

    t["shots_on_target_pct"] = safe_div("shots_on_target", "shots") * 100
    t["npxg_per_shot"] = safe_div("npxg", "shots")
    t["pass_completion_pct"] = safe_div("passes_completed", "passes") * 100
    t["dribble_success_pct"] = safe_div("successful_dribbles", "dribbles") * 100

    # Hide rates built on too few attempts.
    for stat, (attempts, minimum) in RATE_MIN_ATTEMPTS.items():
        t.loc[t[attempts] < minimum, stat] = np.nan
    return t


def stat_column(stat: str) -> str:
    return f"{stat}_p90" if STATS[stat]["kind"] == "p90" else stat


def load_events(where: str, params: dict) -> pd.DataFrame:
    sql = f"""SELECT {EVENT_COLUMNS}, m.competition_id, m.season_id, m.season_name, m.competition_name
              FROM events e JOIN matches m ON e.match_id = m.match_id
              WHERE e.player_id IS NOT NULL AND {where}"""
    return pd.read_sql(text(sql), engine, params=params)


def load_minutes(where: str, params: dict) -> pd.DataFrame:
    sql = f"""SELECT pm.*, m.competition_id, m.season_id, m.season_name, m.competition_name
              FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id WHERE {where}"""
    return pd.read_sql(text(sql), engine, params=params)


SEASON_KEYS = ["player_id", "competition_id", "season_id", "competition_name", "season_name"]


def build_player_season_table() -> pd.DataFrame:
    """Aggregate every player-season in the database, one competition-season at a time
    (keeps memory low). Stored in the player_season_stats table by scripts/build_metrics.py."""
    seasons = pd.read_sql("SELECT DISTINCT competition_id, season_id FROM matches", engine)
    parts = []
    for _, s in seasons.iterrows():
        params = {"c": int(s.competition_id), "s": int(s.season_id)}
        where = "m.competition_id = :c AND m.season_id = :s"
        parts.append(aggregate(load_events(where, params), load_minutes(where, params), SEASON_KEYS))
    table = pd.concat(parts, ignore_index=True)
    names = pd.read_sql("SELECT player_id, name, nickname FROM players", engine)
    return table.merge(names, on="player_id", how="left")


# ---------------------------------------------------------------------------
# Percentiles
# ---------------------------------------------------------------------------

def comparison_pool(season_table: pd.DataFrame, group: str) -> pd.DataFrame:
    return season_table[(season_table["position_group"] == group) & (season_table["minutes"] >= MIN_MINUTES)]


def percentile(value, pool_values: pd.Series):
    """Share of the pool below `value`, ties counting half. None if not computable."""
    pool_values = pool_values.dropna()
    if value is None or pd.isna(value) or pool_values.empty:
        return None
    below = (pool_values < value).mean()
    equal = (pool_values == value).mean()
    return round(float((below + equal / 2) * 100), 1)


def stat_rows(row: pd.Series, pool: pd.DataFrame) -> list[dict]:
    """The key-stats table: value per 90 (or rate) plus percentile vs the pool, for one scope."""
    out = []
    for stat, meta in STATS.items():
        col = stat_column(stat)
        value = row.get(col)
        total = row.get(stat)
        out.append({
            "key": stat,
            "label": meta["label"],
            "kind": meta["kind"],
            "value": None if pd.isna(value) else round(float(value), 2),
            "total": None if meta["kind"] != "p90" or total is None or pd.isna(total)   # missing stays missing
            else round(float(total), 1) if stat == "npxg" or stat.endswith("_padj")
            else int(total),
            "percentile": percentile(value, pool[col]),
        })
    return out
