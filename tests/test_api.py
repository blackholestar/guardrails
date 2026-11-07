"""API tests (replace the old Streamlit smoke test)."""
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.glossary import GLOSSARY

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_glossary_has_help_for_every_metric():
    body = client.get("/api/glossary").json()
    assert set(body["metrics"]) == set(GLOSSARY)
    assert all(v["help"] and v["label"] for v in body["metrics"].values())
    assert "no_bills" in body["flags"]


def test_accounts_lists_examples():
    body = client.get("/api/accounts?limit=3").json()
    assert body["count"] == 4500
    assert len(body["examples"]) == 3


def test_account_profile_and_baseline():
    r = client.get("/api/accounts/20134")
    assert r.status_code == 200
    body = r.json()
    assert body["account_id"] == 20134
    for k in ("I", "F", "S", "B", "H", "P"):
        assert k in body["profile"]
    assert body["baseline"] == body["shocked"]  # no shock supplied


def test_account_shock_query_params_change_result():
    base = client.get("/api/accounts/20134").json()
    shocked = client.get("/api/accounts/20134?income_multiplier=0.55&income_months=6").json()
    assert shocked["shock"]["income_multiplier"] == 0.55
    assert shocked["shocked"]["runway_months"] < base["shocked"]["runway_months"]
    assert shocked["baseline"] == base["baseline"]
    assert "makes_it" in shocked["shocked"]


def test_unknown_account_is_404():
    assert client.get("/api/accounts/5").status_code == 404


def test_invalid_shock_value_is_422():
    assert client.get("/api/accounts/20134?income_multiplier=-1").status_code == 422
