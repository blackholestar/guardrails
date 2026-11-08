"""Resilience engine core: customer profiles and shock calculator.

All "judge" numbers follow the Tangerine README definitions exactly:
  I  typical monthly money in   = median(money_in)
  F  typical fixed costs        = median(household_bills + insurance + loan_payments)
  S  typical monthly spending   = median(money_out)
  B  buffer                     = mean(avg_daily_balance) over the account's last 6 rows, sorted by month
  H  household bills            = median(household_bills)
  P  loan payment               = loans.monthly_payment if the loan is still running at end of 2025
                                  (status C or D), otherwise 0
  Runway = (B - one_off) / (spending_after - income_after), capped at 120, rounded to 1 decimal;
           0 if the buffer is gone; "no shortfall (120+)" if there is no monthly gap.

Extra (non-judge) signals from our analysis are kept in separate columns, never mixed into
the judge numbers.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

RUNWAY_CAP = 120
NO_SHORTFALL = "no shortfall (120+)"
RUNNING_LOAN_STATUSES = {"C", "D"}


# ---------------------------------------------------------------- loading
def load(data_dir: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    data_dir = Path(data_dir)
    ms = pd.read_csv(data_dir / "monthly_summary.csv")
    loans = pd.read_csv(data_dir / "loans.csv")
    # "YYYY-MM" strings sort correctly, but sort explicitly so "last 6 rows" is unambiguous
    ms = ms.sort_values(["account_id", "month"], kind="stable").reset_index(drop=True)
    return ms, loans


# ---------------------------------------------------------------- profiles
def build_profiles(ms: pd.DataFrame, loans: pd.DataFrame) -> pd.DataFrame:
    """One row per account with every judge number plus our extra risk signals."""
    g = ms.groupby("account_id", sort=True)
    fixed = ms.household_bills + ms.insurance + ms.loan_payments

    prof = pd.DataFrame({
        "I_income": g.money_in.median(),
        "F_fixed_costs": fixed.groupby(ms.account_id).median(),
        "S_spending": g.money_out.median(),
        "B_buffer": g.tail(6).groupby("account_id").avg_daily_balance.mean(),
        "H_household_bills": g.household_bills.median(),
        "months_of_history": g.size(),
        "first_month": g.month.min(),
        "last_month": g.month.max(),
    })

    running = loans[loans.status.isin(RUNNING_LOAN_STATUSES)].set_index("account_id").monthly_payment
    prof["P_loan_payment"] = running.reindex(prof.index).fillna(0.0)
    prof["has_running_loan"] = prof.index.isin(running.index)

    # ---- extra signals (our findings), computed on the last 12 months
    last12 = g.tail(12)
    g12 = last12.groupby("account_id")
    mean_in = g12.money_in.mean()
    prof["income_volatility"] = (g12.money_in.std() / mean_in.where(mean_in > 0)).fillna(0.0)
    prof["worst_day_balance_12m"] = g12.min_balance.min()
    prof["days_below_zero_12m"] = g12.days_below_zero.sum()

    # ---- flags
    prof["flag_no_regular_income"] = prof.I_income <= 0
    prof["flag_inactive"] = prof.last_month < ms.month.max()
    prof["flag_unsteady_income"] = prof.income_volatility >= 0.5
    prof["flag_near_zero_dip"] = prof.worst_day_balance_12m < 500

    prof["base_runway"] = [runway_value(r.I_income, r.S_spending, r.B_buffer) for r in prof.itertuples()]
    return prof


# ---------------------------------------------------------------- runway
def runway_value(income: float, spending: float, buffer: float, one_off: float = 0.0):
    """README runway formula. Returns a float (1 decimal) or the NO_SHORTFALL string."""
    buffer_left = buffer - one_off
    gap = spending - income
    if buffer_left <= 0:
        return 0.0
    if gap <= 0:
        return NO_SHORTFALL
    return round(min(buffer_left / gap, RUNWAY_CAP), 1)


def runway_number(value) -> float:
    """Numeric version for comparisons/charts (NO_SHORTFALL -> 120)."""
    return float(RUNWAY_CAP) if value == NO_SHORTFALL else float(value)


@dataclass
class Shock:
    """A scenario. All fields are optional and combine.

    income_factor : multiply income (job loss with EI at 55% -> 0.55; full loss -> 0.0)
    bills_pct     : household bills go up by this fraction (0.15 = +15%) -> spending += pct * H
    spending_add  : extra fixed monthly cost in dollars (e.g. new rent increase in $)
    one_off       : a one-time cost taken from the buffer (e.g. furnace = 1 month of spending)
    one_off_months_of_spending : alternative way to size the one-off, as multiples of S
    duration_months : how long the shock lasts (e.g. EI pays for 6 months) - used for "do they make it?"
    """
    income_factor: float = 1.0
    bills_pct: float = 0.0
    spending_add: float = 0.0
    one_off: float = 0.0
    one_off_months_of_spending: float = 0.0
    duration_months: float | None = None
    label: str = "custom"


def apply_shock(p: pd.Series, shock: Shock) -> dict:
    income_after = p.I_income * shock.income_factor
    spending_after = p.S_spending + shock.bills_pct * p.H_household_bills + shock.spending_add
    one_off = shock.one_off + shock.one_off_months_of_spending * p.S_spending
    before = runway_value(p.I_income, p.S_spending, p.B_buffer)
    after = runway_value(income_after, spending_after, p.B_buffer, one_off)
    out = {
        "scenario": shock.label,
        "income_before": round(p.I_income, 2), "income_after": round(income_after, 2),
        "spending_before": round(p.S_spending, 2), "spending_after": round(spending_after, 2),
        "buffer": round(p.B_buffer, 2), "one_off_cost": round(one_off, 2),
        "buffer_after_one_off": round(p.B_buffer - one_off, 2),
        "monthly_gap_after": round(spending_after - income_after, 2),
        "runway_before": before, "runway_after": after,
    }
    if shock.duration_months is not None:
        out["shock_duration_months"] = shock.duration_months
        out["makes_it"] = runway_number(after) >= shock.duration_months
    return out


# ---------------------------------------------------------------- preset scenarios (README examples)
PRESETS = {
    "job_loss_ei": Shock(income_factor=0.55, duration_months=6, label="Laid off, EI 55% for 6 months"),
    "furnace": Shock(one_off_months_of_spending=1.0, label="Furnace dies (1 month of spending)"),
    "job_loss_bills15": Shock(income_factor=0.55, bills_pct=0.15, duration_months=6,
                              label="Laid off (EI 55%) + household bills +15%"),
}
