"""Build the player_season_stats table (per-90s, rates, position groups) from the events.

Run from backend/ after the preload:
    .venv/Scripts/python -m scripts.build_metrics

It then prints a verification table for Messi and two other players.
"""
import sys

import pandas as pd

from app import metrics
from app.db import engine

CHECK_PLAYERS = {5503: "Lionel Messi", 5216: "Andrés Iniesta", 5203: "Sergio Busquets"}
CHECK_SEASON = "2010/2011"


def main():
    possession = metrics.build_possession_table()
    possession.to_sql("team_match_possession", engine, if_exists="replace", index=False)
    print(f"Possession estimated for {possession.match_id.nunique()} matches "
          f"(Barcelona average: {possession[possession.team == 'Barcelona'].pass_share.mean():.0%})")
    table = metrics.build_player_season_table()
    table.to_sql("player_season_stats", engine, if_exists="replace", index=False)
    # Record the six criteria with their provenance (measured / imputed / unavailable).
    from scripts import fill_criteria
    fill_criteria.main()
    print(f"Stored {len(table)} player-seasons "
          f"({(table.minutes >= metrics.MIN_MINUTES).sum()} with >= {metrics.MIN_MINUTES} minutes)")
    print("Comparison pool sizes:",
          {g: len(metrics.comparison_pool(table, g)) for g in ["DEF", "MID", "FWD"]})

    pd.set_option("display.width", 200)
    for pid, name in CHECK_PLAYERS.items():
        row = table[(table.player_id == pid) & (table.season_name == CHECK_SEASON)]
        if row.empty:
            print(f"\n{name}: no {CHECK_SEASON} data")
            continue
        row = row.iloc[0]
        pool = metrics.comparison_pool(table, row.position_group)
        print(f"\n{name} — La Liga {CHECK_SEASON} — {row.primary_position} ({row.position_group}), "
              f"{row.minutes:.0f} min, {row.matches} matches, pool of {len(pool)}")
        rows = pd.DataFrame(metrics.stat_rows(row, pool))[["label", "total", "value", "percentile"]]
        print(rows.to_string(index=False))


if __name__ == "__main__":
    sys.exit(main())
