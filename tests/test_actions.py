"""Action checks and metric mapping (src/actions.py) on synthetic accounts, plus engine agreement."""
import pytest

from src.actions import Action, apply_actions
from src.engine import Shock, runway

PROFILE = {"I": 5000.0, "F": 2500.0, "S": 4500.0, "H": 1500.0, "P": 600.0, "B": 20000.0}
NEUTRAL = {"income_multiplier": 1.0, "income_months": None, "bills_pct": 0.0, "one_off_cost": 0.0, "extra_monthly": 0.0}
EI = {**NEUTRAL, "income_multiplier": 0.55, "income_months": 6}


def _account(**over):
    base = {}
    for col, med in [("cash_withdrawals_genuine", 2000.0), ("card_withdrawals", 0.0), ("transfers_out_other", 300.0),
                     ("bank_fees", 10.0), ("insurance", 200.0)]:
        base[f"med12_{col}"] = med
        base[f"avg12_{col}"] = med
    base.update(over)
    return base


REFS = {
    "SO-1": {"type": "standing_order", "category": "insurance", "amount": 200.0, "label": "insurance"},
    "SO-2": {"type": "standing_order", "category": "household_bills", "amount": 1500.0, "label": "household bills"},
    "loan-9": {"type": "loan", "category": "loan_payment", "amount": 600.0, "label": "loan"},
    "payer-7": {"type": "payer", "category": "income", "amount": 1000.0, "label": "regular payer"},
}


def act(kind, category, amount, ref=None, evidence="data line"):
    return Action(kind=kind, category=category, ref=ref, title=f"{category}", monthly_amount=amount,
                  how="steps", evidence=evidence, difficulty="easy")


def run(actions, impact=EI, account=None, spending=None):
    spending = PROFILE["S"] if spending is None else spending
    return apply_actions(impact, actions, PROFILE, account or _account(), REFS, spending)


@pytest.mark.parametrize("kind,category,ref,expected", [
    ("cut_spending", "cash_withdrawals", None, {"S": -100}),
    ("cut_spending", "transfers_out", None, {"S": -100}),
    ("cut_spending", "bank_fees", None, {"S": -10}),  # capped at the $10 baseline
    ("change_commitment", "household_bills", "SO-2", {"H": -100, "F": -100, "S": -100}),
    ("change_commitment", "insurance", "SO-1", {"F": -100, "S": -100}),
    ("change_commitment", "loan_payment", "loan-9", {"P": -100, "F": -100, "S": -100}),
    ("add_income", "income", "payer-7", {"I": 100}),
])
def test_each_category_maps_to_fixed_metric_changes(kind, category, ref, expected):
    out = run([act(kind, category, 100, ref)])
    assert out["actions"][0]["metric_changes"] == pytest.approx(expected)


def test_cut_is_capped_at_category_baseline():
    out = run([act("cut_spending", "cash_withdrawals", 5000)])
    a = out["actions"][0]
    assert a["status"] == "adjusted" and a["monthly_amount"] == 2000 and a["requested_amount"] == 5000
    assert out["notes"]


def test_lumpy_category_uses_monthly_average_as_cap():
    out = run([act("cut_spending", "cash_withdrawals", 900)],
              account=_account(med12_cash_withdrawals_genuine=0.0, avg12_cash_withdrawals_genuine=1000.0))
    assert out["actions"][0]["monthly_amount"] == 900


def test_two_cuts_share_one_cap():
    out = run([act("cut_spending", "cash_withdrawals", 1500), act("cut_spending", "cash_withdrawals", 1500)])
    assert [a["monthly_amount"] for a in out["actions"]] == [1500, 500]
    assert out["totals"]["S"] == -2000


def test_standing_order_ref_caps_the_amount():
    out = run([act("change_commitment", "insurance", 500, "SO-1")])
    assert out["actions"][0]["monthly_amount"] == 200


def test_unknown_ref_is_dropped():
    out = run([act("change_commitment", "insurance", 50, "SO-404")])
    assert out["actions"][0]["status"] == "dropped" and out["totals"]["S"] == 0


def test_ref_of_wrong_category_is_dropped():
    out = run([act("change_commitment", "insurance", 50, "loan-9")])
    assert out["actions"][0]["status"] == "dropped"


def test_kind_category_mismatch_is_dropped():
    out = run([act("cut_spending", "loan_payment", 50)])
    assert out["actions"][0]["status"] == "dropped"


def test_income_cannot_exceed_income_lost():
    out = run([act("add_income", "income", 5000)])  # lost 45% of 5000 = 2250
    assert out["actions"][0]["monthly_amount"] == pytest.approx(2250)


def test_income_action_dropped_when_no_income_lost():
    out = run([act("add_income", "income", 500)], impact=NEUTRAL)
    assert out["actions"][0]["status"] == "dropped"


def test_income_action_needs_a_basis():
    out = run([act("add_income", "income", 500, evidence="  ")])
    assert out["actions"][0]["status"] == "dropped"


def test_cuts_cannot_exceed_spending_after_event():
    out = run([act("cut_spending", "cash_withdrawals", 2000)], spending=1200)
    assert out["actions"][0]["monthly_amount"] == 1200


def test_zero_amount_is_advice_with_no_metric_change():
    out = run([act("change_commitment", "loan_payment", 0, "loan-9")])
    assert out["actions"][0]["status"] == "advice" and out["actions"][0]["metric_changes"] == {}
    assert out["totals"]["S"] == 0 and not out["notes"]


def test_negative_amount_is_treated_as_positive():
    assert act("cut_spending", "cash_withdrawals", -250).monthly_amount == 250


def test_no_actions_means_plan_equals_impact():
    out = run([])
    assert out["variables"] == {**EI, "extra_income": 0.0}
    assert out["totals"] == {"I": 0, "F": 0, "S": 0, "H": 0, "P": 0}


def test_engine_on_plan_variables_matches_action_totals():
    actions = [act("cut_spending", "cash_withdrawals", 400), act("change_commitment", "household_bills", 150, "SO-2"),
               act("change_commitment", "loan_payment", 200, "loan-9"), act("add_income", "income", 300, "payer-7")]
    out = run(actions)
    P = PROFILE
    impact = runway(P["B"], P["I"], P["S"], P["H"], Shock(**EI))
    plan = runway(P["B"], P["I"], P["S"], P["H"], Shock(**out["variables"]))
    assert plan["spending_after"] - impact["spending_after"] == pytest.approx(out["totals"]["S"])
    assert plan["income_after"] - impact["income_after"] == pytest.approx(out["totals"]["I"])
    assert out["totals"]["S"] == pytest.approx(-750)
    assert out["totals"]["F"] == pytest.approx(-350)
