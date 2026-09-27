"""Players tab listing: every player reachable, pagination, filters, accent-insensitive search."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import players
from app.main import app

client = TestClient(app)

NAMES = ["Luka Modrić", "Lionel Messi", "Xavi", "Sergio Busquets", "Andrés Iniesta"]


@pytest.fixture(autouse=True)
def synthetic_players(monkeypatch):
    rows = []
    for pid in range(1, 58):                      # 57 players, some with two seasons
        name = NAMES[pid - 1] if pid <= len(NAMES) else f"Player {pid:02d}"
        group = ["FWD", "MID", "DEF", "GK"][pid % 4]
        for season, minutes in [("2014/2015", 1000 + pid), ("2015/2016", 500)][: 1 + pid % 2]:
            rows.append({"player_id": pid, "name": name, "nickname": None, "minutes": minutes, "season_name": season,
                         "team": f"Team {pid % 3}", "primary_position": "Center Forward", "position_group": group})
    table = pd.DataFrame(rows)
    monkeypatch.setattr(players, "season_table", lambda: table)
    monkeypatch.setattr(players, "demo_map", lambda: pd.DataFrame({"statsbomb_id": [2.0]}))
    players.careers.cache_clear()
    yield
    players.careers.cache_clear()


def test_every_player_is_reachable_exactly_once_across_pages():
    first = players.list_players(page_size=10)
    assert first["total"] == 57 and first["pages"] == 6
    keys = [p["key"] for page in range(1, 7) for p in players.list_players(page=page, page_size=10)["results"]]
    assert len(keys) == 57 and len(set(keys)) == 57


def test_default_sort_is_by_minutes_and_one_row_per_player():
    r = players.list_players(page_size=5)["results"]
    assert [p["minutes"] for p in r] == sorted([p["minutes"] for p in r], reverse=True)
    assert r[0]["seasons"] in (1, 2)


def test_search_ignores_accents_and_case():
    assert [p["name"] for p in players.list_players(q="MODRIC")["results"]] == ["Luka Modrić"]
    assert [p["name"] for p in players.search("andres")] == ["Andrés Iniesta"]


def test_position_filter_and_name_sort():
    r = players.list_players(group="GK", sort="name", page_size=100)
    assert r["total"] == len([i for i in range(1, 58) if i % 4 == 3])
    names = [p["name"] for p in r["results"]]
    assert names == sorted(names) and all(p["position_group"] == "GK" for p in r["results"])


def test_page_past_the_end_is_empty_but_reports_totals():
    r = players.list_players(page=99, page_size=25)
    assert r["results"] == [] and r["total"] == 57 and r["pages"] == 3


def test_page_size_is_capped():
    assert players.list_players(page_size=10_000)["page_size"] == players.MAX_PAGE_SIZE


def test_api_validates_and_paginates():
    r = client.get("/api/players", params={"page": 2, "page_size": 20}).json()
    assert r["page"] == 2 and len(r["results"]) == 20 and r["total"] == 57
    assert client.get("/api/players", params={"group": "XYZ"}).status_code == 422
    assert client.get("/api/players", params={"page_size": 500}).status_code == 422
    assert client.get("/api/players", params={"page": 0}).status_code == 422


def test_demo_players_are_flagged_and_search_still_prefers_them():
    assert players.list_players(q="messi")["results"][0]["is_demo"] is True
