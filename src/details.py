"""Per-account detail tables for the AI plan, built once from the raw CSVs.

The judges' numbers (I, F, S, B, H, P) stay in src/features.py. This module adds the detail a plan
needs to say *where* money can come from: spending by category over the last 12 months, standing
orders, loan terms, recurring payees and payers, cash habits, balances, people, cards and district.

"Normal" here means the median over each account's last 12 months in monthly_summary (every account
has at least 12), plus the last-3-month median as a trend.

Outputs, under cache/details/:
  accounts.parquet  one row per account_id (scalars)
  orders.parquet    standing orders, with whether each shows up in the account's activity
  payees.parquet    debits to outside accounts, grouped by partner_account (last 12 months)
  payers.parquet    credits from outside accounts, grouped by partner_account (last 12 months)

Run: python -m src.details [account_id]
"""
import sys
import time

import pandas as pd

from .features import DATA_DIR, ROOT, RUNNING

DETAILS_DIR = ROOT / "cache" / "details"
WINDOW = 12  # months of history that define "normal" for each category
TREND = 3  # months used for the recent trend
END = pd.Period("2025-12", freq="M")  # end of the data, used for loan months remaining

# Plan categories that reduce spending, and the monthly_summary column holding each one.
# Verified against the data:
# - "other" (blank-purpose) standing orders appear as unlabelled transfers out -> transfers_out_other.
# - leasing standing orders never appear in transactions or money_out, so they have no column.
CATEGORY_COLUMNS = {
    "cash_withdrawals": "cash_withdrawals_genuine",
    "card_spending": "card_withdrawals",
    "transfers_out": "transfers_out_other",
    "bank_fees": "bank_fees",
    "household_bills": "household_bills",
    "insurance": "insurance",
    "loan_payment": "loan_payments",
    "leasing": None,
}
INCOME_COLUMNS = ["cash_deposits", "transfers_in", "pension_in", "interest_in"]

# standing_orders.purpose -> plan category
ORDER_CATEGORY = {
    "household bills": "household_bills",
    "insurance": "insurance",
    "loan payment": "loan_payment",
    "leasing": "leasing",
    "other": "transfers_out",
}


def _month_index(month: pd.Series) -> pd.Series:
    """'YYYY-MM' or Timestamp -> integer months since year 0, for window arithmetic."""
    p = pd.to_datetime(month)
    return p.dt.year * 12 + p.dt.month - 1


def _monthly(m: pd.DataFrame) -> pd.DataFrame:
    """Scalar facts from each account's last WINDOW months of monthly_summary."""
    g = m.groupby("account_id")
    cols = [c for c in CATEGORY_COLUMNS.values() if c] + INCOME_COLUMNS + ["money_in", "money_out"]
    last3 = m[m["mi"] > m["last_mi"] - TREND].groupby("account_id")
    out = pd.DataFrame(index=g.size().index)
    out["months_window"] = g.size()
    out["window_start"] = g["month"].min()
    out["window_end"] = g["month"].max()
    for c in cols:
        out[f"med12_{c}"] = g[c].median()
        out[f"avg12_{c}"] = g[c].mean()  # lumpy categories (e.g. cash every other month) have a low median
        out[f"med3_{c}"] = last3[c].median()
    total_out = g["money_out"].sum()
    total_in = g["money_in"].sum()
    for c in [c for c in CATEGORY_COLUMNS.values() if c]:
        out[f"share12_{c}"] = (g[c].sum() / total_out).where(total_out > 0)
    for c in INCOME_COLUMNS:
        out[f"inshare12_{c}"] = (g[c].sum() / total_in).where(total_in > 0)
    out["savings_rate12"] = ((total_in - total_out) / total_in).where(total_in > 0)
    out["deficit_months12"] = (m["money_out"] > m["money_in"]).groupby(m["account_id"]).sum()
    mean_in = g["money_in"].mean()
    out["income_cv12"] = (g["money_in"].std(ddof=0) / mean_in).where(mean_in > 0)
    out["days_below_zero12"] = g["days_below_zero"].sum()
    out["min_balance12"] = g["min_balance"].min()
    out["end_balance_last"] = g["month_end_balance"].last()
    out["end_balance_first"] = g["month_end_balance"].first()
    peak = m.loc[g["money_out"].idxmax(), ["account_id", "month", "money_out"]].set_index("account_id")
    out["peak_spend_month"] = peak["month"]
    out["peak_spend_amount"] = peak["money_out"]
    low = m.loc[g["money_in"].idxmin(), ["account_id", "month", "money_in"]].set_index("account_id")
    out["low_income_month"] = low["month"]
    out["low_income_amount"] = low["money_in"]
    return out


def _cash_habits(tx: pd.DataFrame, months: pd.Series) -> pd.DataFrame:
    cash = tx[tx["operation"] == "cash withdrawal"].groupby("account_id")["amount"]
    card = tx[tx["operation"] == "card withdrawal"].groupby("account_id")["amount"]
    pen = tx[tx["purpose"] == "penalty interest (negative balance)"].groupby("account_id")["amount"]
    out = pd.DataFrame(index=months.index)
    out["cash_wd_per_month"] = (cash.size() / months).reindex(out.index).fillna(0.0)
    out["cash_wd_median"] = cash.median()
    out["cash_wd_p90"] = cash.quantile(0.9)
    out["cash_wd_max"] = cash.max()
    out["card_wd_per_month"] = (card.size() / months).reindex(out.index).fillna(0.0)
    out["card_wd_median"] = card.median()
    out["penalty_count12"] = pen.size().reindex(out.index).fillna(0).astype(int)
    out["penalty_total12"] = pen.sum().reindex(out.index).fillna(0.0)
    return out


def _partners(tx: pd.DataFrame, debit: bool, months: pd.Series) -> pd.DataFrame:
    """Group transfers to/from outside accounts by partner_account over the window."""
    side = tx["direction"].str.startswith("debit" if debit else "credit")
    # partner_account "0" with no bank is a placeholder on cash, card and bill-payment rows, not a real partner.
    t = tx[side & tx["partner_account"].notna() & tx["partner_bank"].notna()].copy()
    t["ym"] = t["date"].dt.to_period("M")
    t["day"] = t["date"].dt.day
    g = t.groupby(["account_id", "partner_account"])
    out = g.agg(
        partner_bank=("partner_bank", "first"),
        n=("amount", "size"),
        months_active=("ym", "nunique"),
        median_amount=("amount", "median"),
        total=("amount", "sum"),
        purpose=("purpose", lambda s: s.mode().iat[0] if s.notna().any() else None),
        typical_day=("day", "median"),
        day_spread=("day", lambda s: float(s.max() - s.min())),
    ).reset_index()
    out["monthly_avg"] = out["total"] / out["account_id"].map(months)
    out["recurring"] = out["months_active"] >= WINDOW // 2
    return out.sort_values(["account_id", "monthly_avg"], ascending=[True, False]).reset_index(drop=True)


def _orders(payees: pd.DataFrame) -> pd.DataFrame:
    so = pd.read_csv(DATA_DIR / "standing_orders.csv", dtype={"to_bank": str, "to_account": str})
    so["purpose"] = so["purpose"].fillna("other")
    so["category"] = so["purpose"].map(ORDER_CATEGORY)
    seen = payees[["account_id", "partner_account", "months_active"]].rename(columns={"partner_account": "to_account"})
    so = so.merge(seen, on=["account_id", "to_account"], how="left")
    so["months_active"] = so["months_active"].fillna(0).astype(int)
    so["seen_in_activity"] = so["months_active"] > 0
    return so.sort_values(["account_id", "amount"], ascending=[True, False]).reset_index(drop=True)


def _context(index: pd.Index, features_I: pd.Series) -> pd.DataFrame:
    out = pd.DataFrame(index=index)
    loans = pd.read_csv(DATA_DIR / "loans.csv").set_index("account_id")
    start = pd.to_datetime(loans["loan_start"]).dt.to_period("M")
    elapsed = start.apply(lambda p: (END - p).n)
    for c in ["loan_id", "amount", "duration_months", "monthly_payment", "status", "status_meaning", "loan_start"]:
        out[f"loan_{c}"] = loans[c].reindex(index)
    out["loan_running"] = loans["status"].isin(RUNNING).reindex(index).fillna(False).astype(bool)
    out["loan_months_left"] = (loans["duration_months"] - elapsed).clip(lower=0).reindex(index)
    out["loan_payment_to_income"] = (out["loan_monthly_payment"] / features_I).where(out["loan_running"] & (features_I > 0))

    acc = pd.read_csv(DATA_DIR / "accounts.csv").set_index("account_id")
    out["statement_frequency"] = acc["frequency"].reindex(index)
    out["account_opened"] = acc["account_opened"].reindex(index)
    dist = pd.read_csv(DATA_DIR / "districts.csv").set_index("district_id")
    d = acc["district_id"].reindex(index)
    out["district_avg_salary"] = d.map(dist["average_salary"])
    out["district_unemployment_2023"] = d.map(dist["unemployment_rate_2023"])

    disp = pd.read_csv(DATA_DIR / "dispositions.csv")
    out["authorized_users"] = disp[disp["type"] != "owner"].groupby("account_id").size().reindex(index).fillna(0).astype(int)
    cards = pd.read_csv(DATA_DIR / "cards.csv").merge(disp, on="disposition_id")
    out["cards"] = cards.groupby("account_id")["card_type"].apply(lambda s: ", ".join(sorted(s))).reindex(index)
    return out


def build_details() -> dict[str, pd.DataFrame]:
    from .features import load_features

    m = pd.read_csv(DATA_DIR / "monthly_summary.csv").sort_values(["account_id", "month"])
    m["mi"] = _month_index(m["month"])
    m["last_mi"] = m.groupby("account_id")["mi"].transform("max")
    m = m[m["mi"] > m["last_mi"] - WINDOW].reset_index(drop=True)
    last_mi = m.groupby("account_id")["last_mi"].first()

    tx = pd.read_csv(
        DATA_DIR / "transactions.csv",
        usecols=["account_id", "date", "direction", "operation", "purpose", "amount", "partner_bank", "partner_account"],
        dtype={"partner_bank": str, "partner_account": str},
        parse_dates=["date"],
    )
    tx = tx[_month_index(tx["date"]) > tx["account_id"].map(last_mi) - WINDOW]

    acc = _monthly(m)
    months = acc["months_window"]
    acc = acc.join(_cash_habits(tx, months))
    acc = acc.join(_context(acc.index, load_features()["I"].reindex(acc.index)))
    payees = _partners(tx, debit=True, months=months)
    payers = _partners(tx, debit=False, months=months)
    orders = _orders(payees)

    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    out = {"accounts": acc, "orders": orders, "payees": payees, "payers": payers}
    for name, df in out.items():
        df.to_parquet(DETAILS_DIR / f"{name}.parquet")
    return out


_cache: dict[str, pd.DataFrame] | None = None


def load_details(rebuild: bool = False) -> dict[str, pd.DataFrame]:
    """Load the detail tables (kept in memory), building them first if missing."""
    global _cache
    if rebuild or not all((DETAILS_DIR / f"{n}.parquet").exists() for n in ("accounts", "orders", "payees", "payers")):
        _cache = build_details()
    elif _cache is None:
        _cache = {n: pd.read_parquet(DETAILS_DIR / f"{n}.parquet") for n in ("accounts", "orders", "payees", "payers")}
    return _cache


if __name__ == "__main__":
    t0 = time.time()
    d = load_details(rebuild=True)
    print(f"built {DETAILS_DIR} in {time.time() - t0:.1f}s ({len(d['accounts'])} accounts)")
    acc_id = int(sys.argv[1]) if len(sys.argv) > 1 else 20134
    with pd.option_context("display.max_rows", 200, "display.width", 160):
        print(d["accounts"].loc[acc_id].to_string())
        for n in ("orders", "payees", "payers"):
            print(f"\n{n}:\n{d[n][d[n]['account_id'] == acc_id].to_string()}")
