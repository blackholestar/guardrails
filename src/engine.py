"""Shock engine. Pure functions, no I/O, no AI.

Runway (months), per data/README.md:
    buffer_left = B - one_off_costs
    gap         = spending_after_shock - income_after_shock
    if buffer_left <= 0: runway = 0
    elif gap <= 0:       runway = "no shortfall (120+)"
    else:                runway = min(buffer_left / gap, 120)
Rounded to 1 decimal.
"""
from dataclasses import dataclass


@dataclass
class Shock:
    income_multiplier: float = 1.0   # e.g. 0.55 for EI
    income_months: int | None = None  # duration of the income change (None = permanent)
    bills_pct: float = 0.0           # e.g. 0.15 for +15% household bills
    one_off_cost: float = 0.0        # e.g. a repair


def compute(account_id: int, shock: Shock) -> dict:
    """Return baseline and shocked numbers for one account."""
    raise NotImplementedError
