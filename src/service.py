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


def _baseline_cards(profile: dict, baseline: dict) -> dict:
    """Headline card values with no shock applied."""
    return {
        "I": profile["I"], "F": profile["F"], "S": baseline["spending_after"], "B": baseline["buffer_left"],
        "H": profile["H"], "P": profile["P"], "gap": baseline["gap"], "runway": baseline["runway_months"],
        "runway_label": baseline["runway_label"],
    }


def _shocked_cards(profile: dict, shock_vars: dict, result: dict, f_delta: float = 0.0, p_delta: float = 0.0) -> dict:
    """Headline card values under a set of shock variables. Pure arithmetic on engine output.

    H moves with bills_pct; F moves by the same dollar amount (bills are part of fixed costs).
    f_delta and p_delta are further changes to F and P from plan actions (insurance and loan payment changes).
    """
    h_after = profile["H"] * (1 + shock_vars["bills_pct"])
    return {
        "I": result["income_after"], "F": profile["F"] + (h_after - profile["H"]) + f_delta,
        "S": result["spending_after"], "B": result["buffer_left"], "H": h_after, "P": profile["P"] + p_delta,
        "gap": result["gap"], "runway": result["runway_months"], "runway_label": result["runway_label"],
    }


def _metric_changes(before: dict, after: dict) -> dict:
    """Before/after/delta for each headline card between two card snapshots."""
    out = {
        k: {"before": before[k], "after": after[k], "delta": after[k] - before[k]}
        for k in before if k != "runway_label"
    }
    out["runway"]["before_label"] = before["runway_label"]
    out["runway"]["after_label"] = after["runway_label"]
    return out


MAX_TURNS = 40  # conversation length limit (user + model turns)


class BadConversation(ValueError):
    """The follow-up history is malformed (no plan in it, wrong turn order). Message is safe to show."""


def _context(account_id: int):
    """Everything the prompt needs about one account. Raises KeyError if unknown."""
    from .details import load_details
    from .guidance import load_guides, load_insights
    from .summary import format_account_summary

    base = get_account(account_id)  # raises KeyError if unknown
    details = load_details()
    summary, refs = format_account_summary(int(account_id), _get_features(), details)
    return {"base": base, "details": details, "summary": summary, "refs": refs,
            "insights": load_insights(), "guides": load_guides()}


def _score(account_id: int, ctx: dict, ai_plan: dict) -> dict:
    """Check the AI's actions and compute baseline, impact and plan with the engine.

    ai_plan: {"impact_summary", "assumptions", "impact": ShockVars dict, "plan": PlanOut dict}.
    """
    from .actions import Action, apply_actions

    base, features = ctx["base"], _get_features()
    impact = compute(int(account_id), Shock(**ai_plan["impact"]), features=features)
    applied = apply_actions(
        ai_plan["impact"], [Action(**a) for a in ai_plan["plan"]["actions"]], base["profile"],
        ctx["details"]["accounts"].loc[int(account_id)], ctx["refs"], impact["shocked"]["spending_after"],
    )
    planned = compute(int(account_id), Shock(**applied["variables"]), features=features)
    t = applied["totals"]
    base_cards = _baseline_cards(base["profile"], base["baseline"])
    impact_cards = _shocked_cards(base["profile"], ai_plan["impact"], impact["shocked"])
    plan_cards = _shocked_cards(base["profile"], applied["variables"], planned["shocked"],
                                f_delta=t["F"] - t["H"], p_delta=t["P"])
    plan = ai_plan["plan"]
    return _clean({
        "baseline": base["baseline"],
        "impact_summary": ai_plan["impact_summary"],
        "assumptions": ai_plan["assumptions"],
        "impact": {
            "variables": ai_plan["impact"],
            "result": impact["shocked"],
            "metrics": _metric_changes(base_cards, impact_cards),  # original -> after the event
        },
        "plan": {
            "summary": plan["summary"],
            "description": plan["summary"],  # older field name, kept for existing clients
            "justification": plan["justification"],
            "risks": plan["risks"],
            "actions": applied["actions"],  # each with checked monthly_amount, metric_changes, status, note
            "totals": t,  # sum of the actions' metric changes
            "notes": applied["notes"],
            "variables": applied["variables"],
            "result": planned["shocked"],
            "metrics": _metric_changes(impact_cards, plan_cards),  # after the event -> with the plan
        },
    })


def plan_scenario(account_id: int, scenario: str) -> dict:
    """Gemini picks the impact and itemized plan actions; code checks the actions, derives each one's metric
    changes, and the engine computes runway for baseline, impact and plan.

    Raises KeyError for an unknown account and ai.AIUnavailable if Gemini fails.
    """
    from . import ai

    ctx = _context(account_id)
    base = ctx["base"]
    ai_out = ai.plan_scenario(base["profile"], base["flags"], scenario, summary=ctx["summary"],
                              insights=ctx["insights"], guides=ctx["guides"])
    return {
        "account_id": int(account_id),
        "scenario": scenario,
        "model": ai_out["model"],
        "prompt_version": ai_out["prompt_version"],
        **_score(account_id, ctx, ai_out),
        "context_summary": ctx["summary"],  # exactly what the AI saw about this account
        "model_turn": ai_out["model_turn"],  # send back as the model turn in follow-up history
    }


def _plan_in_effect(history: list[dict]) -> dict:
    """The latest plan in the conversation: the first plan, or the last revision. Raises BadConversation."""
    import json

    from .ai import PlanUpdate, ScenarioPlan

    for turn in reversed(history):
        if turn["role"] != "model":
            continue
        try:
            data = json.loads(turn["text"])
        except (ValueError, TypeError):
            continue
        try:
            if isinstance(data, dict) and data.get("plan_update"):
                return PlanUpdate.model_validate(data["plan_update"]).model_dump()
            if isinstance(data, dict) and "plan" in data:
                return ScenarioPlan.model_validate(data).model_dump()
        except ValueError:
            continue
    raise BadConversation("The conversation has no plan to follow up on. Make a plan first.")


def follow_up(account_id: int, history: list[dict], message: str) -> dict:
    """Answer a follow-up message about the plan. If the AI revises the plan, the revision is checked and scored
    exactly like the first plan and returned as "revised"; otherwise "revised" is None.

    history: [{"role": "user" | "model", "text": str}, ...] starting with the scenario; model turns are the
    "model_turn" values earlier responses returned. Raises KeyError, BadConversation or ai.AIUnavailable.
    """
    from . import ai

    if not history or history[0]["role"] != "user":
        raise BadConversation("The conversation must start with the scenario.")
    if any(a["role"] == b["role"] for a, b in zip(history, history[1:])) or history[-1]["role"] != "model":
        raise BadConversation("The conversation must alternate between the customer and the AI.")
    if len(history) + 1 > MAX_TURNS:
        raise BadConversation("This conversation is too long. Start a new scenario.")

    ctx = _context(account_id)
    current = _score(account_id, ctx, _plan_in_effect(history))
    base = ctx["base"]
    ai_out = ai.follow_up(base["profile"], base["flags"], history, message, current, summary=ctx["summary"],
                          insights=ctx["insights"], guides=ctx["guides"])
    revised = None
    if ai_out["plan_update"]:
        upd = ai_out["plan_update"]
        revised = {"change_summary": upd["change_summary"], **_score(account_id, ctx, upd),
                   "previous": {"impact": current["impact"]["result"], "plan": current["plan"]["result"]}}
    return {
        "account_id": int(account_id),
        "message": message,
        "reply": ai_out["reply"],
        "revised": revised,
        "model": ai_out["model"],
        "prompt_version": ai_out["prompt_version"],
        "model_turn": ai_out["model_turn"],
    }


def get_account(account_id: int, shock: dict | None = None) -> dict:
    """Profile + baseline + shocked runway for one account."""
    s = Shock(**shock) if shock else Shock()
    return _clean(compute(int(account_id), s, features=_get_features()))
