"""Build the per-account feature table from the CSVs.

Definitions follow data/README.md ("How judges calculate the numbers"):
  I = median(money_in)
  F = median(household_bills + insurance + loan_payments)
  S = median(money_out)
  B = mean(avg_daily_balance) over the last 6 rows, sorted by month
  H = median(household_bills)
  P = monthly_payment if the loan is still running at end of 2025 else 0
"""
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "data"
CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "features.parquet"


def build_features():
    """Return a DataFrame indexed by account_id with I, F, S, B, H, P and context columns."""
    raise NotImplementedError


def load_features():
    """Load the cached feature table, building it first if missing."""
    raise NotImplementedError


if __name__ == "__main__":
    build_features()
