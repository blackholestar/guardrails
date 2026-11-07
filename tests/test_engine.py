"""Tests against the README formulas.

All expected numbers were produced by running Python (not by hand).
Feature tests recompute I, F, S, B, H, P straight from the raw CSVs with the
stdlib `csv`/`statistics` modules, independent of pandas and src/features.py.
"""
import csv
import statistics as st
from collections import defaultdict
from pathlib import Path

import pytest

from src.engine import NO_SHORTFALL, Shock, compute, runway
from src.features import load_features

DATA = Path(__file__).resolve().parents[1] / "data" / "data"

# Synthetic customer: B=20000, I=5000, S=4500, H=1500
B, I, S, H = 20000, 5000, 4500, 1500


# ---------- runway() formula ----------

def test_baseline_no_shortfall():
    # S - I = -500 -> gap <= 0
    r = runway(B, I, S, H, Shock())
    assert r["gap"] == pytest.approx(-500)
    assert r["runway_label"] == NO_SHORTFALL
    assert r["runway_months"] == 120.0


def test_job_loss_ei_55():
    # 20000 / (4500 - 0.55*5000) = 11.428571... -> 11.4
    r = runway(B, I, S, H, Shock(income_multiplier=0.55))
    assert r["runway_months"] == 11.4
    assert r["gap"] == pytest.approx(1750)


def test_bills_up_15_percent_alone_still_no_shortfall():
    # spending = 4500 + 0.15*1500 = 4725; gap = -275
    r = runway(B, I, S, H, Shock(bills_pct=0.15))
    assert r["spending_after"] == pytest.approx(4725)
    assert r["gap"] == pytest.approx(-275)
    assert r["runway_label"] == NO_SHORTFALL


def test_one_off_cost():
    # buffer_left = 20000 - 4500 = 15500; 15500 / (4500 - 2750) = 8.857... -> 8.9
    r = runway(B, I, S, H, Shock(income_multiplier=0.55, one_off_cost=S))
    assert r["buffer_left"] == pytest.approx(15500)
    assert r["runway_months"] == 8.9


def test_mixed_shock():
    # 20000 / (4725 - 2750) = 10.1265... -> 10.1
    r = runway(B, I, S, H, Shock(income_multiplier=0.55, bills_pct=0.15))
    assert r["runway_months"] == 10.1


def test_extra_monthly_cost():
    # gap = 4500 + 500 - 5000 = 0 -> no shortfall
    r = runway(B, I, S, H, Shock(extra_monthly=500))
    assert r["gap"] == pytest.approx(0)
    assert r["runway_label"] == NO_SHORTFALL


def test_buffer_zero_or_negative_gives_zero_runway():
    assert runway(0, I, S, H, Shock(income_multiplier=0.55))["runway_months"] == 0
    assert runway(-500, I, S, H, Shock(income_multiplier=0.55))["runway_months"] == 0


def test_one_off_cost_exceeding_buffer_gives_zero_runway():
    r = runway(B, I, S, H, Shock(one_off_cost=B + 1))
    assert r["runway_months"] == 0
    assert r["runway_label"] == 0


def test_buffer_exactly_consumed_gives_zero_runway():
    assert runway(B, I, S, H, Shock(one_off_cost=B))["runway_months"] == 0


def test_runway_capped_at_120():
    # B=1e6, gap=100 -> 10000 months uncapped
    r = runway(1_000_000, 1000, 1100, 0, Shock())
    assert r["runway_months"] == 120.0
    assert r["runway_label"] == 120.0


def test_zero_income_runway_is_buffer_over_spending():
    # 20000 / 4500 = 4.444... -> 4.4
    r = runway(B, 0, S, H, Shock())
    assert r["runway_months"] == 4.4


def test_zero_bills_makes_bill_shock_a_noop():
    base = runway(B, I, S, 0, Shock(income_multiplier=0.55))
    with_bills = runway(B, I, S, 0, Shock(income_multiplier=0.55, bills_pct=0.15))
    assert base == with_bills


def test_makes_it_depends_on_duration():
    # runway 11.4 months
    assert runway(B, I, S, H, Shock(income_multiplier=0.55, income_months=6))["makes_it"] is True
    assert runway(B, I, S, H, Shock(income_multiplier=0.55, income_months=12))["makes_it"] is False


def test_makes_it_absent_without_duration():
    assert "makes_it" not in runway(B, I, S, H, Shock(income_multiplier=0.55))


# ---------- features vs raw CSVs (independent implementation) ----------

def _raw_stats(account_id: int) -> dict:
    rows = [r for r in csv.DictReader(open(DATA / "monthly_summary.csv"))
            if r["account_id"] == str(account_id)]
    rows.sort(key=lambda r: r["month"])
    col = lambda k: [float(r[k]) for r in rows]
    fixed = [a + b + c for a, b, c in zip(col("household_bills"), col("insurance"), col("loan_payments"))]
    return {
        "I": st.median(col("money_in")),
        "F": st.median(fixed),
        "S": st.median(col("money_out")),
        "H": st.median(col("household_bills")),
        "B": sum(col("avg_daily_balance")[-6:]) / 6,
        "n": len(rows),
    }


@pytest.fixture(scope="module")
def features():
    return load_features(rebuild=True)


@pytest.mark.parametrize("account_id", [20111, 20133, 20134])
def test_features_match_raw_csv(features, account_id):
    raw = _raw_stats(account_id)
    row = features.loc[account_id]
    for k in ("I", "F", "S", "H", "B"):
        assert row[k] == pytest.approx(raw[k]), k
    assert row["months_history"] == raw["n"]


def _loan_account(running: bool) -> tuple[int, float]:
    for r in csv.DictReader(open(DATA / "loans.csv")):
        if (r["status"] in ("C", "D")) == running:
            return int(r["account_id"]), float(r["monthly_payment"])
    raise AssertionError("no matching loan found")


def test_P_is_monthly_payment_for_running_loan(features):
    acc, pay = _loan_account(running=True)
    if acc in features.index:
        assert features.loc[acc, "P"] == pytest.approx(pay)


def test_P_is_zero_for_finished_loan(features):
    acc, _ = _loan_account(running=False)
    if acc in features.index:
        assert features.loc[acc, "P"] == 0


def test_P_is_zero_without_loan(features):
    with_loan = {int(r["account_id"]) for r in csv.DictReader(open(DATA / "loans.csv"))}
    no_loan = [a for a in features.index if a not in with_loan][0]
    assert features.loc[no_loan, "P"] == 0


def test_feature_table_covers_all_accounts(features):
    n = sum(1 for _ in csv.DictReader(open(DATA / "accounts.csv")))
    assert len(features) == n


# ---------- compute() end to end ----------

def test_compute_uses_feature_values(features):
    raw = _raw_stats(20134)
    res = compute(20134, Shock(income_multiplier=0.55, bills_pct=0.15), features=features)
    expected = runway(raw["B"], raw["I"], raw["S"], raw["H"],
                      Shock(income_multiplier=0.55, bills_pct=0.15))
    assert res["shocked"]["runway_months"] == expected["runway_months"]
    assert res["baseline"]["runway_months"] == runway(raw["B"], raw["I"], raw["S"], raw["H"], Shock())["runway_months"]


def test_compute_unknown_account_raises(features):
    with pytest.raises(KeyError):
        compute(1, features=features)


def test_compute_flags_zero_bills_account(features):
    # account 20111 has median household_bills == 0
    assert "no_bills" in compute(20111, features=features)["flags"]
