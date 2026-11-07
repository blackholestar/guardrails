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

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "data"
CACHE_PATH = ROOT / "cache" / "features.parquet"

RUNNING = {"C", "D"}  # loan statuses that are still running


def build_features() -> pd.DataFrame:
    """Return a DataFrame indexed by account_id with I, F, S, B, H, P and context columns."""
    m = pd.read_csv(DATA_DIR / "monthly_summary.csv").sort_values(["account_id", "month"])
    m["fixed"] = m["household_bills"] + m["insurance"] + m["loan_payments"]

    g = m.groupby("account_id")
    f = pd.DataFrame(
        {
            "I": g["money_in"].median(),
            "F": g["fixed"].median(),
            "S": g["money_out"].median(),
            "H": g["household_bills"].median(),
            "B": g["avg_daily_balance"].apply(lambda s: s.tail(6).mean()),
            "months_history": g.size(),
            "first_month": g["month"].first(),
            "last_month": g["month"].last(),
            # extra context for breakdowns / guardrails
            "insurance": g["insurance"].median(),
            "loan_payments_hist": g["loan_payments"].median(),
            "cash_withdrawals": g["cash_withdrawals_genuine"].median(),
            "card_withdrawals": g["card_withdrawals"].median(),
            "transfers_out_other": g["transfers_out_other"].median(),
            "bank_fees": g["bank_fees"].median(),
            "pension_in": g["pension_in"].median(),
            "days_below_zero_total": g["days_below_zero"].sum(),
        }
    )

    # P: judges use monthly_payment if the loan is still running at end of 2025.
    loans = pd.read_csv(DATA_DIR / "loans.csv").set_index("account_id")
    running = loans["status"].isin(RUNNING)
    f["P"] = loans["monthly_payment"].where(running).reindex(f.index).fillna(0.0)
    f["loan_status"] = loans["status"].reindex(f.index)
    f["loan_defaulted"] = loans["defaulted"].reindex(f.index)

    # Context from accounts / districts / owner's birth date.
    acc = pd.read_csv(DATA_DIR / "accounts.csv").set_index("account_id")
    dist = pd.read_csv(DATA_DIR / "districts.csv").set_index("district_id")
    f["district_id"] = acc["district_id"].reindex(f.index)
    f["district_name"] = f["district_id"].map(dist["district_name"])
    f["region"] = f["district_id"].map(dist["region"])

    cl = pd.read_csv(DATA_DIR / "clients.csv", parse_dates=["birth_date"]).set_index("client_id")
    disp = pd.read_csv(DATA_DIR / "dispositions.csv")
    owners = disp[disp["type"] == "owner"].drop_duplicates("account_id").set_index("account_id")
    birth = owners["client_id"].map(cl["birth_date"]).reindex(f.index)
    f["owner_age"] = ((pd.Timestamp("2025-12-31") - birth).dt.days / 365.25).round(0)
    f["owner_gender"] = owners["client_id"].map(cl["gender"]).reindex(f.index)

    # Guardrail flags.
    f["flag_short_history"] = f["months_history"] < 6
    f["flag_no_income"] = f["I"] <= 0
    f["flag_no_bills"] = f["H"] <= 0
    f["flag_negative_buffer"] = f["B"] <= 0

    CACHE_PATH.parent.mkdir(exist_ok=True)
    f.to_parquet(CACHE_PATH)
    return f


def load_features(rebuild: bool = False) -> pd.DataFrame:
    """Load the cached feature table, building it first if missing."""
    if rebuild or not CACHE_PATH.exists():
        return build_features()
    return pd.read_parquet(CACHE_PATH)


if __name__ == "__main__":
    out = build_features()
    print(out.describe().T.round(1).to_string())
    print(f"\nwrote {CACHE_PATH} ({len(out)} accounts)")
