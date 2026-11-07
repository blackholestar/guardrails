"""Shock engine. Pure functions, no AI.

Runway (months), per data/README.md:
    buffer_left = B - one_off_costs
    gap         = spending_after_shock - income_after_shock
    if buffer_left <= 0: runway = 0
    elif gap <= 0:       runway = "no shortfall (120+)"
    else:                runway = min(buffer_left / gap, 120)
Rounded to 1 decimal.
"""
from dataclasses import asdict, dataclass

import pandas as pd

from .features import load_features

RUNWAY_CAP = 120.0
NO_SHORTFALL = "no shortfall (120+)"


@dataclass
class Shock:
    income_multiplier: float = 1.0    # e.g. 0.55 for EI
    income_months: int | None = None  # how long the income change lasts (None = indefinite)
    bills_pct: float = 0.0            # e.g. 0.15 for +15% household bills
    one_off_cost: float = 0.0         # e.g. a repair
    extra_monthly: float = 0.0        # any other added monthly cost (e.g. higher rent beyond H)


def runway(B: float, I: float, S: float, H: float, shock: Shock) -> dict:
    """Judge-compatible runway for given base numbers and a shock."""
    income = shock.income_multiplier * I
    spending = S + shock.bills_pct * H + shock.extra_monthly
    buffer_left = B - shock.one_off_cost
    gap = spending - income

    if buffer_left <= 0:
        months, label = 0.0, 0.0
    elif gap <= 0:
        months, label = RUNWAY_CAP, NO_SHORTFALL
    else:
        months = min(buffer_left / gap, RUNWAY_CAP)
        label = round(months, 1)

    out = {
        "income_after": income,
        "spending_after": spending,
        "buffer_left": buffer_left,
        "gap": gap,
        "runway_months": round(months, 1),
        "runway_label": label,
    }
    # "Do they make it?": runway covers the whole shock period.
    if shock.income_months is not None:
        out["makes_it"] = months >= shock.income_months
    return out


def compute(account_id: int, shock: Shock | None = None, features: pd.DataFrame | None = None) -> dict:
    """Return baseline and shocked numbers for one account."""
    shock = shock or Shock()
    f = features if features is not None else load_features()
    if account_id not in f.index:
        raise KeyError(f"account_id {account_id} not found")
    r = f.loc[account_id]
    B, I, S, H = float(r["B"]), float(r["I"]), float(r["S"]), float(r["H"])

    flags = [k.replace("flag_", "") for k in f.columns if k.startswith("flag_") and bool(r[k])]
    return {
        "account_id": int(account_id),
        "profile": {
            "I": I, "F": float(r["F"]), "S": S, "B": B, "H": H, "P": float(r["P"]),
            "months_history": int(r["months_history"]),
            "region": r["region"], "district": r["district_name"], "owner_age": r["owner_age"],
            "loan_status": r["loan_status"],
        },
        "flags": flags,
        "shock": asdict(shock),
        "baseline": runway(B, I, S, H, Shock()),
        "shocked": runway(B, I, S, H, shock),
    }
