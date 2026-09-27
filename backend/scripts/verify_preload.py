"""Sanity check for the preload: Messi's La Liga goals and assists per season.

Run from backend/:  .venv/Scripts/python -m scripts.verify_preload

Goals  = shots with outcome "Goal" (penalties included, own goals excluded).
Assists = passes StatsBomb flags as goal assists.
Compare against published La Liga totals (e.g. 2011/12: 50 goals, 2014/15: 43 goals).
"""
import pandas as pd
from sqlalchemy import text

from app.db import engine

MESSI = 5503

query = """
SELECT m.season_name AS season,
       COUNT(DISTINCT pm.match_id)                                   AS apps,
       ROUND(SUM(pm.minutes))                                        AS minutes,
       (SELECT COUNT(*) FROM events e JOIN matches m2 ON e.match_id = m2.match_id
         WHERE e.player_id = :pid AND e.type = 'Shot' AND e.shot_outcome = 'Goal'
           AND m2.season_name = m.season_name AND m2.competition_id = m.competition_id) AS goals,
       (SELECT COUNT(*) FROM events e JOIN matches m2 ON e.match_id = m2.match_id
         WHERE e.player_id = :pid AND e.type = 'Pass' AND e.pass_goal_assist = 1
           AND m2.season_name = m.season_name AND m2.competition_id = m.competition_id) AS assists
FROM player_matches pm JOIN matches m ON pm.match_id = m.match_id
WHERE pm.player_id = :pid
GROUP BY m.competition_name, m.season_name
ORDER BY m.competition_id DESC, m.season_name
"""

if __name__ == "__main__":
    df = pd.read_sql(text(query), engine, params={"pid": MESSI})
    print("Lionel Messi — StatsBomb Open Data")
    print(df.to_string(index=False))
