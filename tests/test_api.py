"""API contract tests. They need the trained artifacts, so they are skipped until
`python -m glucotwin.pipeline` has been run."""

import pytest

from glucotwin import config as C

pytestmark = pytest.mark.skipif(not (C.ARTIFACT_DIR / "models.joblib").exists(),
                                reason="run `python -m glucotwin.pipeline` first")

AT = "2026-09-11T12:10:00"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from glucotwin.api import app
    return TestClient(app)


@pytest.fixture(scope="module")
def ward(client):
    return client.get(f"/api/ward?at={AT}").json()


def test_ward_is_triaged_and_explained(ward):
    ps = ward["patients"]
    assert ps and all({"patient_id", "tier", "p_spike", "reason", "on_hypo_agents"} <= p.keys() for p in ps)
    order = {"high": 0, "moderate": 1, "low": 2}
    keys = [(order[p["tier"]], -p["p_spike"]) for p in ps]
    assert keys == sorted(keys)


def test_patient_state_freshness_and_no_peeking(client, ward):
    pid = ward["patients"][0]["patient_id"]
    d = client.get(f"/api/patients/{pid}?at={AT}").json()
    assert d["outcome"] is None                                  # never revealed unless asked
    assert {"plasma_glucose", "carbs_on_board_g", "insulin_action_e4"} <= d["state"].keys()
    assert d["freshness"]["missing_last_hour"] <= 12
    assert all(t <= d["at"] for t in d["history"]["ts"] + d["alerts"])
    r = client.get(f"/api/patients/{pid}?at={AT}&reveal=true").json()
    assert r["outcome"]["ts"] and min(r["outcome"]["ts"]) > r["at"]
    assert r["risk"] == d["risk"]                                # revealing the future cannot change the model


def test_alerts_outcomes_use_only_the_past(client):
    a = client.get(f"/api/alerts?at={AT}&hours=24").json()
    assert sum(a["counts"].values()) == len(a["events"])
    for e in a["events"]:
        assert e["ts"] <= a["at"] and e["outcome"] in ("excursion", "no_excursion", "pending")
        assert (e["lead_min"] is not None) == (e["outcome"] == "excursion")


def test_timeline_stops_at_the_clock(client, ward):
    pid = ward["patients"][0]["patient_id"]
    tl = client.get(f"/api/patients/{pid}/timeline?at={AT}").json()
    assert all(m["ts"] <= tl["at"] for m in tl["meals"]) and all(t <= tl["at"] for t in tl["alerts"])
    assert len(tl["hourly_mean"]) <= 24 * C.N_DAYS


def test_status_meta_and_validation(client):
    assert client.get("/api/status").json()["models_loaded"] is True
    meta = client.get("/api/meta").json()
    assert 0 < meta["thresholds"]["spike_alert"] < meta["thresholds"]["spike_high"] <= 1
    assert client.get("/api/ward?at=not-a-time").status_code == 422
    assert client.get("/api/alerts?hours=500").status_code == 422
    assert client.get("/api/patients/P999/timeline").status_code == 404
    assert client.get("/").headers["cache-control"] == "no-cache"
