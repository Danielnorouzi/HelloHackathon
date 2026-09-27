"""Download StatsBomb Open Data for the demo competitions and store it in SQLite.

Run from backend/:
    .venv/Scripts/python -m scripts.preload_statsbomb

What it loads
- La Liga, every season in StatsBomb Open Data from 2004/05 to 2020/21 (Messi's Barcelona career)
- FIFA World Cup 2022

The script can be resumed: matches already in the database are skipped.
Events for ALL players are stored (slimmed to the fields we use), because
percentiles need every player in the dataset, not only the demo players.

Data: StatsBomb Open Data (https://github.com/statsbomb/open-data), free for non-commercial use.
"""
import json
import sys
import warnings
import os
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests
import requests_cache
from statsbombpy import public, sb

from app.db import Match, Player, PlayerMap, SessionLocal, engine, init_db
from app.settings import CONFIG_DIR

warnings.filterwarnings("ignore")  # statsbombpy warns about missing API credentials on every call

# statsbombpy opens a new HTTPS connection per file and caches every response in a temp SQLite
# file. We store the data ourselves, so turn that cache off and reuse one connection per worker
# process (opening a connection can take seconds; reusing one takes ~0.1 s).
requests_cache.uninstall_cache()
_session = requests.Session()


def _get_response(path):
    response = _session.get(path, timeout=60)
    response.raise_for_status()
    return response.json()


public.get_response = _get_response

LA_LIGA = 11
WORLD_CUP = 43
WORLD_CUP_2022 = 106
OLD_LA_LIGA_SEASON = 278  # 1973/74, not part of Messi's career

# StatsBomb column -> our events column
EVENT_COLUMNS = {
    "id": "event_id", "match_id": "match_id", "period": "period", "minute": "minute", "second": "second",
    "team": "team", "player_id": "player_id", "player": "player", "position": "position", "type": "type",
    "play_pattern": "play_pattern", "under_pressure": "under_pressure",
    "pass_recipient_id": "pass_recipient_id", "pass_recipient": "pass_recipient", "pass_outcome": "pass_outcome",
    "pass_height": "pass_height", "pass_type": "pass_type", "pass_shot_assist": "pass_shot_assist",
    "pass_goal_assist": "pass_goal_assist", "pass_cross": "pass_cross", "pass_through_ball": "pass_through_ball",
    "dribble_outcome": "dribble_outcome", "shot_statsbomb_xg": "shot_xg", "shot_outcome": "shot_outcome",
    "shot_type": "shot_type", "duel_type": "duel_type", "duel_outcome": "duel_outcome",
    "interception_outcome": "interception_outcome", "counterpress": "counterpress",
}

# On-ball and defensive actions we keep. Everything else (Starting XI, Half Start, ...) is dropped.
KEEP_TYPES = {
    "Pass", "Carry", "Shot", "Dribble", "Ball Receipt*", "Duel", "Interception", "Pressure",
    "Ball Recovery", "Block", "Clearance", "Foul Won", "Miscontrol", "Dispossessed", "Dribbled Past",
}

BOOL_COLUMNS = ["under_pressure", "pass_shot_assist", "pass_goal_assist", "pass_cross",
                "pass_through_ball", "counterpress"]


def demo_competitions():
    """Return (competition_id, season_id) pairs to load."""
    comps = sb.competitions()
    la_liga = comps[(comps.competition_id == LA_LIGA) & (comps.season_id != OLD_LA_LIGA_SEASON)]
    pairs = [(LA_LIGA, int(s)) for s in la_liga.season_id]
    pairs.append((WORLD_CUP, WORLD_CUP_2022))
    return pairs


def slim_events(raw: pd.DataFrame) -> pd.DataFrame:
    """Keep the event types and columns the app uses; split locations into x/y."""
    # Penalty shootouts (period 5) are not match play: they must not count as shots or goals.
    ev = raw[raw["type"].isin(KEEP_TYPES) & (raw["period"] <= 4)].copy()
    for col in EVENT_COLUMNS:
        if col not in ev.columns:
            ev[col] = np.nan
    out = ev[list(EVENT_COLUMNS)].rename(columns=EVENT_COLUMNS)

    loc = ev["location"].apply(lambda v: v if isinstance(v, list) else [np.nan, np.nan])
    out["x"] = loc.str[0]
    out["y"] = loc.str[1]

    # End location comes from whichever event-specific column is filled.
    end = pd.Series([None] * len(ev), index=ev.index, dtype=object)
    for col in ["pass_end_location", "carry_end_location", "shot_end_location"]:
        if col in ev.columns:
            end = end.where(end.notna(), ev[col])
    end = end.apply(lambda v: v if isinstance(v, list) else [np.nan, np.nan])
    out["end_x"] = end.str[0]
    out["end_y"] = end.str[1]

    body = ev["pass_body_part"] if "pass_body_part" in ev.columns else pd.Series(np.nan, index=ev.index)
    if "shot_body_part" in ev.columns:
        body = body.where(body.notna(), ev["shot_body_part"])
    out["body_part"] = body

    for col in BOOL_COLUMNS:
        out[col] = out[col].fillna(False).astype(bool)
    return out


def minutes_played(raw: pd.DataFrame, lineups: dict, match_id: int) -> pd.DataFrame:
    """Minutes per player from the Starting XI, substitutions and red cards.

    StatsBomb's lineup "positions" spells are sometimes out of order, so we use the
    event stream instead: starters come on at 0:00, substitutes at their Substitution
    event, and a player goes off at their Substitution event, a red card, or the final
    whistle. Times use StatsBomb's running match clock (minute*60 + second).
    Penalty shootouts (period 5) are excluded.
    """
    in_play = raw[raw["period"] <= 4]
    clock = in_play["minute"] * 60 + in_play["second"]
    end_clock = int(clock.max())

    on, off = {}, {}
    for _, e in in_play[in_play["type"] == "Starting XI"].iterrows():
        for p in e["tactics"]["lineup"]:
            on[p["player"]["id"]] = 0
    for idx, e in in_play[in_play["type"] == "Substitution"].iterrows():
        off[int(e["player_id"])] = int(clock[idx])
        on[int(e["substitution_replacement_id"])] = int(clock[idx])
    for col in ["foul_committed_card", "bad_behaviour_card"]:
        if col in in_play.columns:
            sent_off = in_play[in_play[col].isin(["Red Card", "Second Yellow"])]
            for idx, e in sent_off.iterrows():
                off[int(e["player_id"])] = min(off.get(int(e["player_id"]), end_clock), int(clock[idx]))

    # Position = where the player made most of their actions in this match.
    positions = in_play.dropna(subset=["player_id", "position"]).groupby("player_id")["position"]         .agg(lambda s: s.value_counts().index[0])

    rows = []
    for team, df in lineups.items():
        for _, p in df.iterrows():
            pid = int(p["player_id"])
            if pid not in on:
                continue  # unused substitute
            first_spell = p["positions"][0]["position"] if p["positions"] else None
            rows.append({
                "match_id": match_id,
                "player_id": pid,
                "team": team,
                "minutes": round(max(off.get(pid, end_clock) - on[pid], 0) / 60, 1),
                "position": positions.get(pid, first_spell),
                "started": on[pid] == 0,
                # carried along for the players table
                "_name": p["player_name"],
                "_nickname": p["player_nickname"] if isinstance(p["player_nickname"], str) else None,
                "_country": p["country"],
            })
    return pd.DataFrame(rows)


def fetch_match(match_id: int):
    """Download one match (events + lineups). Runs in a worker process."""
    raw = sb.events(match_id=match_id)
    lineups = sb.lineups(match_id=match_id)
    return slim_events(raw), minutes_played(raw, lineups, match_id)


def load_demo_player_map(session):
    """Manually mapped demo players (config/demo_players.json). No fuzzy matching in the MVP."""
    path = CONFIG_DIR / "demo_players.json"
    if not path.exists():
        print("No config/demo_players.json yet, skipping player map")
        return
    demo = json.loads(path.read_text(encoding="utf-8"))
    session.query(PlayerMap).filter(PlayerMap.is_demo.is_(True)).delete()
    for p in demo:
        session.add(PlayerMap(is_demo=True, **p))
    session.commit()


def main():
    init_db()
    session = SessionLocal()
    existing = {m for (m,) in session.query(Match.match_id).all()}
    known_players = {p for (p,) in session.query(Player.player_id).all()}

    # 1. Collect the match list for every demo competition-season.
    todo = []
    for comp_id, season_id in demo_competitions():
        matches = sb.matches(competition_id=comp_id, season_id=season_id)
        for _, m in matches.iterrows():
            if int(m.match_id) in existing:
                continue
            todo.append((comp_id, season_id, m))
    print(f"{len(existing)} matches already loaded, {len(todo)} to download")

    # 2. Download in parallel; write to SQLite from the main process only.
    done = 0
    # Parsing is CPU-bound, so use processes (threads would be limited by the GIL).
    with ProcessPoolExecutor(max_workers=min(12, max(2, (os.cpu_count() or 4) - 1))) as pool:
        futures = {pool.submit(fetch_match, int(item[2].match_id)): item for item in todo}
        for fut in as_completed(futures):
            comp_id, season_id, m = futures[fut]
            try:
                events, minutes = fut.result()
            except Exception as exc:  # network hiccup: skip, a re-run will retry it
                print(f"  ! match {m.match_id} failed: {exc}")
                continue

            new_players = minutes[~minutes.player_id.isin(known_players)]
            for _, p in new_players.iterrows():
                session.add(Player(player_id=int(p["player_id"]), name=p["_name"], nickname=p["_nickname"], country=p["_country"]))
                known_players.add(int(p["player_id"]))

            session.add(Match(
                match_id=int(m.match_id), competition_id=comp_id,
                competition_name=m.competition, season_id=season_id, season_name=m.season,
                match_date=str(m.match_date), home_team=m.home_team, away_team=m.away_team,
                home_score=int(m.home_score), away_score=int(m.away_score),
            ))
            session.commit()
            events.to_sql("events", engine, if_exists="append", index=False)
            minutes.drop(columns=["_name", "_nickname", "_country"]).to_sql(
                "player_matches", engine, if_exists="append", index=False)

            done += 1
            if done % 25 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)} matches stored")

    load_demo_player_map(session)
    print("Done. Matches in database:", session.query(Match).count())


if __name__ == "__main__":
    sys.exit(main())
