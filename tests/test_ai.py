"""Gemini connection-check tests. The real API is never called; the client is faked."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src import ai
from src.api import app

client = TestClient(app)


class FakeClient:
    def __init__(self, text="pong", raises=None):
        self.models = SimpleNamespace(generate_content=self._gen)
        self._text, self._raises, self.calls = text, raises, []

    def _gen(self, model, contents, config=None):
        self.calls.append((model, contents))
        if self._raises:
            raise self._raises
        return SimpleNamespace(text=self._text)


@pytest.fixture
def fake(monkeypatch):
    f = FakeClient()
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: f)
    return f


def test_chat_returns_reply_and_model(fake):
    out = ai.chat("ping")
    assert out == {"reply": "pong", "model": "test-model"}
    assert fake.calls == [("test-model", "ping")]


def test_chat_missing_model_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    with pytest.raises(ai.AIUnavailable, match="GEMINI_MODEL"):
        ai.chat("hi")


def test_chat_missing_key_raises(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(ai, "_client", None)
    with pytest.raises(ai.AIUnavailable, match="GEMINI_API_KEY"):
        ai.chat("hi")


def test_chat_wraps_sdk_errors_without_leaking_details(monkeypatch):
    f = FakeClient(raises=RuntimeError("secret-key-abc in url"))
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: f)
    with pytest.raises(ai.AIUnavailable) as e:
        ai.chat("hi")
    assert "secret-key-abc" not in str(e.value)


def test_chat_empty_reply_raises(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: FakeClient(text=None))
    with pytest.raises(ai.AIUnavailable, match="empty"):
        ai.chat("hi")


def test_endpoint_ok(fake):
    r = client.post("/api/ai/chat", json={"message": "ping"})
    assert r.status_code == 200
    assert r.json() == {"reply": "pong", "model": "test-model"}


def test_endpoint_503_when_unavailable(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    r = client.post("/api/ai/chat", json={"message": "ping"})
    assert r.status_code == 503
    assert "GEMINI_MODEL" in r.json()["detail"]


@pytest.mark.parametrize("body", [{}, {"message": ""}, {"message": "x" * 2001}])
def test_endpoint_validates_message(body):
    assert client.post("/api/ai/chat", json=body).status_code == 422


# ---- scenario planning ----
import json

PLAN_JSON = {
    "impact_summary": "Job loss, EI at 55% for 6 months.",
    "impact": {"income_multiplier": 0.55, "income_months": 6, "bills_pct": 0, "one_off_cost": 0, "extra_monthly": 0},
    "plan": {
        "description": "Cut discretionary spending.",
        "justification": "Spending exceeds EI income.",
        "changes": {"income_multiplier": 0.55, "income_months": 6, "bills_pct": 0, "one_off_cost": 0,
                    "extra_monthly": -300},
    },
}


class PlanFake(FakeClient):
    def _gen(self, model, contents, config=None):
        self.calls.append((model, contents, config))
        return SimpleNamespace(text=json.dumps(PLAN_JSON))


def test_plan_scenario_scores_baseline_impact_and_plan(monkeypatch):
    from src import service

    f = PlanFake()
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: f)
    out = service.plan_scenario(20134, "I lost my job and get 55% EI")
    assert out["impact"]["variables"]["income_multiplier"] == 0.55
    assert out["plan"]["variables"]["extra_monthly"] == -300
    # engine did the math: cuts raise runway (or both are capped)
    assert out["plan"]["result"]["spending_after"] == out["impact"]["result"]["spending_after"] - 300
    assert out["plan"]["result"]["runway_months"] >= out["impact"]["result"]["runway_months"]
    cfg = f.calls[0][2]
    assert "I=" in cfg.system_instruction  # account numbers reach the model
    assert f.calls[0][1][-1].parts[0].text == "I lost my job and get 55% EI"


def test_plan_scenario_clamps_bad_values(monkeypatch):
    bad = json.loads(json.dumps(PLAN_JSON))
    bad["impact"]["income_multiplier"] = -1
    bad["impact"]["one_off_cost"] = -50
    f = PlanFake()
    f._gen = lambda model, contents, config=None: SimpleNamespace(text=json.dumps(bad))
    f.models = SimpleNamespace(generate_content=f._gen)
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: f)
    out = ai.plan_scenario({"I": 1, "F": 1, "S": 1, "H": 1, "P": 0, "B": 1}, [], "x")
    assert out["impact"]["income_multiplier"] == 0 and out["impact"]["one_off_cost"] == 0


def test_plan_scenario_malformed_json_raises(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: FakeClient(text="not json"))
    with pytest.raises(ai.AIUnavailable, match="unexpected format"):
        ai.plan_scenario({"I": 1, "F": 1, "S": 1, "H": 1, "P": 0, "B": 1}, [], "x")


def test_plan_endpoint_404_and_422(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: PlanFake())
    assert client.post("/api/ai/plan", json={"account_id": 999999999, "scenario": "x"}).status_code == 404
    assert client.post("/api/ai/plan", json={"account_id": 20134, "scenario": ""}).status_code == 422
