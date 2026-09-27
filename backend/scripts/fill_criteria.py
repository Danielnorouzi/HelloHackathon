"""Record the six criteria for every player-season, with where each value came from.

Run from backend/ (after build_metrics; build_metrics also runs this automatically):
    .venv/Scripts/python -m scripts.fill_criteria

For each player-season and criterion (PAC, SHO, PAS, DRI, DEF, PHY):
  1. measured: computed from the source stats already loaded (StatsBomb events).
  2. If missing, check SOURCE_COVERAGE (app/criteria.py): does any available source provide it?
     (PAC and PHY: none. StatsBomb and API-Football have no pace or physical-output fields.)
  3. Otherwise impute: median of measured values for the same criterion in the same position group
     (if it has enough values), else the overall median. Valid values, zeros included, are kept.
  4. If there are no measured values at all to take a median from: "unavailable", with the reason.

Results are stored as columns crit_<C>, crit_<C>_source, crit_<C>_basis on player_season_stats.
Safe to re-run: values are always recomputed from the source stats (never from earlier imputed
values), and the number of rows never changes. A summary is written to data/criteria_report.json.
"""
import json
import sys

import pandas as pd

from app import criteria, metrics, rating
from app.db import engine
from app.settings import DATABASE_PATH

REPORT_PATH = DATABASE_PATH.parent / "criteria_report.json"


def measured_criteria(table: pd.DataFrame) -> list[dict]:
    """Criteria computed from source stats only (no imputation), one record per row."""
    pools = {g: metrics.comparison_pool(table, g) for g in table["position_group"].dropna().unique()}
    records = []
    for _, row in table.iterrows():
        group = row["position_group"]
        stats = metrics.stat_rows(row, pools.get(group, table.iloc[0:0]))
        card = rating.build_card(stats, group, row["minutes"], tier=2, fill=False)
        records.append({"group": group, "minutes": row["minutes"],
                        "values": {c: card["attributes"][c]["value"] for c in criteria.CRITERIA}})
    return records


def fill_table(table: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Pure step (no I/O): returns the table with crit_* columns and a report."""
    base = table[[c for c in table.columns if not c.startswith("crit_")]].copy()   # idempotent: start clean
    records = measured_criteria(base)
    reference = [dict(r, sources={c: "measured" for c in criteria.CRITERIA}) for r in records
                 if r["minutes"] >= criteria.REFERENCE_MIN_MINUTES]
    medians = criteria.compute_medians(reference)

    columns = {f"crit_{c}{suffix}": [] for c in criteria.CRITERIA for suffix in ("", "_source", "_basis")}
    counts = {c: {"measured": 0, "imputed": 0, "unavailable": 0} for c in criteria.CRITERIA}
    for r in records:
        for c in criteria.CRITERIA:
            filled = criteria.fill_value(c, r["values"][c], r["group"], medians)
            columns[f"crit_{c}"].append(filled["value"])
            columns[f"crit_{c}_source"].append(filled["source"])
            columns[f"crit_{c}_basis"].append(filled["basis"])
            counts[c][filled["source"]] += 1
    for name, values in columns.items():
        base[name] = values

    report = {
        "rows": len(base),
        "counts": counts,
        "source_coverage": criteria.SOURCE_COVERAGE,
        "medians": {"overall": {c: {"median": m, "n": n} for c, (m, n) in medians["overall"].items()},
                    "groups": {g: {c: {"median": m, "n": n} for c, (m, n) in v.items()} for g, v in medians["groups"].items()}},
        "min_group_valid": criteria.MIN_GROUP_VALID,
        "reference_min_minutes": criteria.REFERENCE_MIN_MINUTES,
    }
    return base, report


def main():
    table = pd.read_sql("SELECT * FROM player_season_stats", engine)
    rows_before = len(table)
    filled, report = fill_table(table)
    assert len(filled) == rows_before, "fill_criteria must never change the number of rows"
    filled.to_sql("player_season_stats", engine, if_exists="replace", index=False)
    REPORT_PATH.write_text(json.dumps(report, indent=1), encoding="utf-8")

    print(f"{rows_before} player-season rows (unchanged).")
    for c, n in report["counts"].items():
        print(f"  {c}: measured {n['measured']}, imputed {n['imputed']}, unavailable {n['unavailable']}")
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    sys.exit(main())
