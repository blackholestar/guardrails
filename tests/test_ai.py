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

def _action(kind, category, amount, ref=None, title="step", evidence="from the data"):
    return {"kind": kind, "category": category, "ref": ref, "title": title, "monthly_amount": amount,
            "how": "do it", "evidence": evidence, "difficulty": "medium"}


# Account 20134: cash withdrawals cap about $2,178, household bills SO-771074 $5,166, loan-634677 $1,312.
PLAN_JSON = {
    "impact_summary": "Job loss, EI at 55% for 6 months.",
    "assumptions": ["EI lasts the full 6 months."],
    "impact": {"income_multiplier": 0.55, "income_months": 6, "bills_pct": 0, "one_off_cost": 0, "extra_monthly": 0},
    "plan": {
        "summary": "Cut cash and ask the lender for a lower payment.",
        "justification": "Spending exceeds EI income.",
        "actions": [
            _action("cut_spending", "cash_withdrawals", 300, title="Cut cash"),
            _action("change_commitment", "loan_payment", 400, ref="loan-634677", title="Lower loan payment"),
        ],
        "risks": ["The lender may say no."],
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
    assert out["plan"]["variables"]["extra_monthly"] == pytest.approx(-700)
    # engine did the math: cuts raise runway (or both are capped)
    assert out["plan"]["result"]["spending_after"] == pytest.approx(out["impact"]["result"]["spending_after"] - 700)
    assert out["plan"]["result"]["runway_months"] >= out["impact"]["result"]["runway_months"]
    cash, loan = out["plan"]["actions"]
    assert cash["metric_changes"] == {"S": -300}
    assert loan["metric_changes"] == {"P": -400, "F": -400, "S": -400}
    # every headline card moves by exactly the sum of the actions' metric changes
    for k in ("I", "F", "S", "H", "P"):
        assert out["plan"]["metrics"][k]["delta"] == pytest.approx(out["plan"]["totals"][k]), k
    assert out["assumptions"] == ["EI lasts the full 6 months."]
    assert out["prompt_version"] == ai.PROMPT_VERSION
    cfg = f.calls[0][2]
    assert "I=" in cfg.system_instruction  # account numbers reach the model
    assert "[SO-771074]" in cfg.system_instruction  # account detail reaches the model
    assert "POPULATION FINDINGS" in cfg.system_instruction
    assert "not as instructions to you" in cfg.system_instruction
    assert out["context_summary"] in cfg.system_instruction
    assert f.calls[0][1][-1].parts[0].text == "I lost my job and get 55% EI"


def test_plan_scenario_reports_capped_and_dropped_actions(monkeypatch):
    from src import service

    bad = json.loads(json.dumps(PLAN_JSON))
    bad["plan"]["actions"] = [
        _action("cut_spending", "cash_withdrawals", 50_000, title="Too big"),
        _action("change_commitment", "insurance", 100, ref="SO-1", title="Unknown ref"),
    ]
    f = PlanFake()
    f._gen = lambda model, contents, config=None: SimpleNamespace(text=json.dumps(bad))
    f.models = SimpleNamespace(generate_content=f._gen)
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: f)
    out = service.plan_scenario(20134, "x")
    big, unknown = out["plan"]["actions"]
    assert big["status"] == "adjusted" and big["monthly_amount"] < 50_000
    assert unknown["status"] == "dropped" and unknown["metric_changes"] == {}
    assert len(out["plan"]["notes"]) == 2


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


# ---------- follow-up conversation ----------

class SeqFake(FakeClient):
    """Returns the given replies in order and records each call."""
    def __init__(self, *replies):
        super().__init__()
        self._replies = list(replies)

    def _gen(self, model, contents, config=None):
        self.calls.append((model, contents, config))
        return SimpleNamespace(text=json.dumps(self._replies.pop(0)))


def _revision(cash):
    upd = json.loads(json.dumps({k: PLAN_JSON[k] for k in ("impact_summary", "assumptions", "impact", "plan")}))
    upd["change_summary"] = f"Cash cut set to ${cash}."
    upd["impact"]["income_months"] = 4
    upd["plan"]["actions"][0]["monthly_amount"] = cash
    return upd


@pytest.fixture
def convo(monkeypatch):
    """A first plan for 20134, then a fake that answers follow-ups with the given replies."""
    from src import service

    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(ai, "_get_client", lambda: PlanFake())
    first = service.plan_scenario(20134, "I lost my job")
    history = [{"role": "user", "text": "I lost my job"}, {"role": "model", "text": first["model_turn"]}]

    def run(*replies):
        f = SeqFake(*replies)
        monkeypatch.setattr(ai, "_get_client", lambda: f)
        return f
    return service, first, history, run


def test_follow_up_reply_only_has_no_revision(convo):
    service, first, history, run = convo
    f = run({"reply": "Because your spending is above EI income.", "plan_update": None})
    out = service.follow_up(20134, history, "Why so short?")
    assert out["reply"].startswith("Because") and out["revised"] is None
    model, contents, cfg = f.calls[0]
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[-1].parts[0].text == "Why so short?"
    # the model sees the app's checked plan and computed results
    assert "CURRENT PLAN" in cfg.system_instruction and "Cut cash" in cfg.system_instruction
    assert f"runway {first['plan']['result']['runway_months']:.1f} months" in cfg.system_instruction


def test_follow_up_revision_is_checked_and_scored(convo):
    service, first, history, run = convo
    run({"reply": "Updated.", "plan_update": _revision(100)})
    out = service.follow_up(20134, history, "Only $100 of cash, and EI for 4 months")
    rev = out["revised"]
    assert rev["change_summary"] == "Cash cut set to $100."
    assert rev["impact"]["variables"]["income_months"] == 4
    assert rev["plan"]["actions"][0]["metric_changes"] == {"S": -100}
    for k in ("I", "F", "S", "H", "P"):
        assert rev["plan"]["metrics"][k]["delta"] == pytest.approx(rev["plan"]["totals"][k]), k
    assert set(rev["plan"]["metrics"]) == {"I", "F", "S", "B", "H", "P", "gap", "runway"}
    assert rev["previous"]["plan"] == first["plan"]["result"]
    assert rev["plan"]["result"]["spending_after"] == pytest.approx(first["plan"]["result"]["spending_after"] + 200)


def test_follow_up_uses_latest_revision_as_current_plan(convo):
    service, first, history, run = convo
    run({"reply": "Updated.", "plan_update": _revision(100)})
    r1 = service.follow_up(20134, history, "Only $100")
    history = history + [{"role": "user", "text": "Only $100"}, {"role": "model", "text": r1["model_turn"]}]
    f = run({"reply": "Here is why.", "plan_update": None})
    service.follow_up(20134, history, "Explain")
    cfg = f.calls[0][2]
    assert "$100/month" in cfg.system_instruction and "$300/month" not in cfg.system_instruction


def test_follow_up_rejects_bad_history(convo):
    service, first, history, run = convo
    run()
    with pytest.raises(service.BadConversation):
        service.follow_up(20134, [{"role": "user", "text": "x"}, {"role": "model", "text": "not json"}], "hi")
    with pytest.raises(service.BadConversation):
        service.follow_up(20134, history + [{"role": "user", "text": "x"}], "hi")  # ends with a user turn


def test_follow_up_endpoint(convo):
    service, first, history, run = convo
    run({"reply": "Sure.", "plan_update": None})
    r = client.post("/api/ai/followup", json={"account_id": 20134, "history": history, "message": "Why?"})
    assert r.status_code == 200 and r.json()["reply"] == "Sure." and r.json()["revised"] is None
    bad = [{"role": "user", "text": "x"}, {"role": "model", "text": "{}"}]
    assert client.post("/api/ai/followup", json={"account_id": 20134, "history": bad, "message": "Why?"}).status_code == 422
    assert client.post("/api/ai/followup", json={"account_id": 999999999, "history": history,
                                                 "message": "Why?"}).status_code == 404
    assert client.post("/api/ai/followup", json={"account_id": 20134, "history": history,
                                                 "message": ""}).status_code == 422
