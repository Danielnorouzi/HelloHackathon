"""Median filling of the six criteria: sourced vs imputed, group vs overall, zeros kept, re-runnable."""
import math

import numpy as np
import pandas as pd
import pytest

from app import criteria, metrics, players, tier1
from scripts import fill_criteria


def rec(group, sources=None, **values):
    return {"group": group, "values": values, "sources": sources or {}}


# ---------------------------------------------------------------------------
# fill_value / compute_medians
# ---------------------------------------------------------------------------

def test_valid_values_including_zero_are_never_replaced():
    med = criteria.compute_medians([rec("FWD", SHO=70)] * 40)
    assert criteria.fill_value("SHO", 0, "FWD", med) == {"value": 0, "source": "measured", "basis": None}
    assert criteria.fill_value("SHO", 55, "FWD", med)["value"] == 55


def test_nan_and_none_are_missing():
    med = criteria.compute_medians([rec("FWD", SHO=70)] * 40)
    assert criteria.fill_value("SHO", float("nan"), "FWD", med)["source"] == "imputed"
    assert criteria.fill_value("SHO", None, "FWD", med)["source"] == "imputed"


def test_uses_position_median_when_the_group_has_enough_values():
    records = [rec("FWD", SHO=80)] * 30 + [rec("DEF", SHO=50)] * 60
    out = criteria.fill_value("SHO", None, "FWD", criteria.compute_medians(records))
    assert out["value"] == 80 and out["source"] == "imputed" and "30 measured FWD" in out["basis"]


def test_falls_back_to_overall_median_when_the_group_is_small():
    records = [rec("GK", SHO=45)] * 5 + [rec("DEF", SHO=60)] * 60
    out = criteria.fill_value("SHO", None, "GK", criteria.compute_medians(records))
    assert out["value"] == 60 and "Overall median of 65" in out["basis"]


def test_unavailable_when_no_measured_values_exist():
    out = criteria.fill_value("PAC", None, "FWD", criteria.compute_medians([rec("FWD", SHO=70)] * 40))
    assert out["value"] is None and out["source"] == "unavailable" and "tracking data" in out["basis"]


def test_imputed_values_never_feed_other_medians():
    records = [rec("FWD", SHO=80)] * 30 + [rec("FWD", sources={"SHO": "imputed"}, SHO=10)] * 100
    assert criteria.compute_medians(records)["groups"]["FWD"]["SHO"] == (80, 30)


# ---------------------------------------------------------------------------
# fill_table: the reproducible pass over player_season_stats
# ---------------------------------------------------------------------------

def synthetic_season_table(n_per_group=40, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for group in ["FWD", "MID", "DEF"]:
        for i in range(n_per_group):
            row = {"player_id": len(rows) + 1, "position_group": group, "minutes": 1000 + i * 10, "name": f"P{i}",
                   "shots": 30, "passes": 400, "dribbles": 20}
            for stat, meta in metrics.STATS.items():
                value = float(rng.uniform(0, 5)) if meta["kind"] != "pct" else float(rng.uniform(40, 90))
                row[stat] = value
                row[metrics.stat_column(stat)] = value
            rows.append(row)
    return pd.DataFrame(rows)


def test_fill_table_is_idempotent_keeps_row_count_and_labels_sources():
    table = synthetic_season_table()
    once, report = fill_criteria.fill_table(table)
    twice, _ = fill_criteria.fill_table(once)
    assert len(once) == len(twice) == len(table)
    crit_cols = [c for c in once.columns if c.startswith("crit_")]
    pd.testing.assert_frame_equal(once[crit_cols], twice[crit_cols])
    assert set(once["crit_SHO_source"]) == {"measured"}
    assert set(once["crit_PAC_source"]) == {"unavailable"} and once["crit_PAC"].isna().all()
    assert report["counts"]["PHY"]["unavailable"] == len(table)


def test_fill_table_imputes_a_missing_criterion_with_its_position_median():
    table = synthetic_season_table()
    shooting = ["non_penalty_goals", "npxg", "shots_on_target_pct", "npxg_per_shot"]
    for stat in shooting:                       # player 1 (a FWD) has no shooting data at all
        table.loc[0, stat] = np.nan
        table.loc[0, metrics.stat_column(stat)] = np.nan
    filled, report = fill_criteria.fill_table(table)
    fwd_measured = filled[(filled.position_group == "FWD") & (filled.crit_SHO_source == "measured")]["crit_SHO"]
    assert filled.loc[0, "crit_SHO_source"] == "imputed"
    assert filled.loc[0, "crit_SHO"] == round(fwd_measured.median())
    assert "FWD player-seasons" in filled.loc[0, "crit_SHO_basis"]
    assert report["counts"]["SHO"]["imputed"] == 1
    assert (filled.drop(index=0)["crit_SHO_source"] == "measured").all()   # nobody else touched


# ---------------------------------------------------------------------------
# Tier 1 (API-Football): missing stays missing, zero stays zero
# ---------------------------------------------------------------------------

def api_main(**overrides):
    main = {"games": {"minutes": 900, "appearences": 10, "position": "Defender"},
            "shots": {"total": 12, "on": 5}, "dribbles": {"attempts": 4, "success": 2},
            "goals": {"total": 1, "assists": 0}, "penalty": {"scored": None},
            "passes": {"key": 3}, "tackles": {"total": 0, "interceptions": None}}
    for path, value in overrides.items():
        section, field = path.split("__")
        main[section][field] = value
    return main


@pytest.fixture
def tier1_pool(monkeypatch):
    table = synthetic_season_table()
    monkeypatch.setattr(players, "season_table", lambda: table)
    filled, _ = fill_criteria.fill_table(table)
    ref = [{"group": r.position_group, "values": {c: getattr(r, f"crit_{c}") for c in criteria.CRITERIA},
            "sources": {c: getattr(r, f"crit_{c}_source") for c in criteria.CRITERIA}} for r in filled.itertuples()]
    monkeypatch.setattr(criteria, "stored_medians", lambda: criteria.compute_medians(ref))
    return filled


def test_tier1_null_is_missing_but_zero_is_a_value(tier1_pool):
    rows = {r["key"]: r for r in tier1.stat_rows(api_main(), "DEF")}
    assert rows["interceptions"]["value"] is None          # API null: missing, not 0
    assert rows["tackles_won"]["value"] == 0               # real zero kept
    assert rows["assists"]["value"] == 0
    assert rows["non_penalty_goals"]["value"] == pytest.approx(0.1)   # no penalty entry = no penalty goals


def test_tier1_card_imputes_only_a_fully_missing_criterion_and_labels_it(tier1_pool):
    from app import rating
    main = api_main(tackles__total=None, tackles__interceptions=None)        # no defending data at all
    card = rating.build_card(tier1.stat_rows(main, "DEF"), "DEF", 900, tier=1)
    assert card["attributes"]["DEF"]["source"] == "imputed"
    assert card["attributes"]["DEF"]["note"].startswith("Imputed:")
    assert card["attributes"]["SHO"]["source"] == "measured"
    assert card["attributes"]["PAC"]["source"] == "unavailable" and card["attributes"]["PAC"]["value"] is None
    assert card["imputed"] == ["DEF"] and "imputed DEF" in card["ovr_note"]
    assert not math.isnan(card["ovr"])
