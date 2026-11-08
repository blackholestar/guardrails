"""UI-agnostic service layer.

Returns plain JSON-serializable dicts so any front end can use it: Streamlit
today, or a React app later by wrapping `get_account` in a FastAPI route
(e.g. GET /accounts/{id}?income_multiplier=0.55&...).
"""
import math

from .engine import Shock, compute
from .features import load_features

_features = None


def _get_features():
    global _features
    if _features is None:
        _features = load_features()
    return _features


def _clean(obj):
    """Make values JSON-safe (numpy scalars, NaN)."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if hasattr(obj, "item"):  # numpy scalar
        obj = obj.item()
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


def list_account_ids() -> list[int]:
    return [int(i) for i in _get_features().index]


def _metric_changes(profile: dict, baseline: dict, plan_vars: dict, plan_result: dict) -> dict:
    """Before/after/delta for each headline card, under the plan. Pure arithmetic on engine output.

    H moves with bills_pct; F moves by the same dollar amount (bills are part of fixed costs); P is unchanged.
    """
    h_after = profile["H"] * (1 + plan_vars["bills_pct"])
    before = {
        "I": profile["I"], "F": profile["F"], "S": baseline["spending_after"], "B": baseline["buffer_left"],
        "H": profile["H"], "P": profile["P"], "gap": baseline["gap"], "runway": baseline["runway_months"],
    }
    after = {
        "I": plan_result["income_after"], "F": profile["F"] + (h_after - profile["H"]),
        "S": plan_result["spending_after"], "B": plan_result["buffer_left"], "H": h_after, "P": profile["P"],
        "gap": plan_result["gap"], "runway": plan_result["runway_months"],
    }
    out = {k: {"before": before[k], "after": after[k], "delta": after[k] - before[k]} for k in before}
    out["runway"]["before_label"] = baseline["runway_label"]
    out["runway"]["after_label"] = plan_result["runway_label"]
    return out


def plan_scenario(account_id: int, scenario: str) -> dict:
    """Gemini picks the impact and a plan; the engine computes runway for baseline, impact and plan.

    Raises KeyError for an unknown account and ai.AIUnavailable if Gemini fails.
    """
    from . import ai

    base = get_account(account_id)  # raises KeyError if unknown
    ai_out = ai.plan_scenario(base["profile"], base["flags"], scenario)
    features = _get_features()
    impact = compute(int(account_id), Shock(**ai_out["impact"]), features=features)
    planned = compute(int(account_id), Shock(**ai_out["plan"]["changes"]), features=features)
    return _clean({
        "account_id": int(account_id),
        "scenario": scenario,
        "model": ai_out["model"],
        "baseline": base["baseline"],
        "impact_summary": ai_out["impact_summary"],
        "impact": {"variables": ai_out["impact"], "result": impact["shocked"]},
        "plan": {
            "description": ai_out["plan"]["description"],
            "justification": ai_out["plan"]["justification"],
            "variables": ai_out["plan"]["changes"],
            "result": planned["shocked"],
            "metrics": _metric_changes(base["profile"], base["baseline"], ai_out["plan"]["changes"], planned["shocked"]),
        },
    })


def get_account(account_id: int, shock: dict | None = None) -> dict:
    """Profile + baseline + shocked runway for one account."""
    s = Shock(**shock) if shock else Shock()
    return _clean(compute(int(account_id), s, features=_get_features()))
