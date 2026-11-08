"""Plain-text account summary for the AI prompt, plus the ref ids actions may cite.

Every number here is computed by code from cache/details and cache/features.parquet. Gemini reads
this text; src/actions.py uses the returned refs to check the actions Gemini proposes.

Run: python -m src.summary 20134
"""
import math
import sys

import pandas as pd

from .details import load_details
from .features import load_features

MAX_PAYEES = 5  # recurring transfers out not covered by a standing order
MAX_ONE_OFF = 3  # largest non-recurring transfers out
MAX_PAYERS = 3


def _ok(x) -> bool:
    return x is not None and not (isinstance(x, float) and math.isnan(x))


def _m(x) -> str:
    if not _ok(x):
        return "n/a"
    return f"-${-x:,.0f}" if x < 0 else f"${x:,.0f}"


def category_baseline(a: pd.Series, col: str) -> float:
    """Normal monthly amount for a spending category: the larger of the 12-month median and average.

    The median alone hides lumpy spending (cash taken out every other month has a median of 0).
    src/actions.py uses the same number as the cap on cuts.
    """
    vals = [v for v in (a[f"med12_{col}"], a[f"avg12_{col}"]) if _ok(v)]
    return float(max(vals)) if vals else 0.0


def _pct(x) -> str:
    return f"{x * 100:.0f}%" if _ok(x) else "n/a"


def _trend(med12, med3) -> str:
    if not (_ok(med12) and _ok(med3)):
        return ""
    if abs(med3 - med12) < max(0.1 * abs(med12), 1):
        return f"; last 3 months {_m(med3)} (steady)"
    return f"; last 3 months {_m(med3)} ({'up' if med3 > med12 else 'down'})"


def _variability(cv) -> str:
    if not _ok(cv):
        return "n/a"
    return f"{cv:.2f} ({'low' if cv < 0.25 else 'moderate' if cv < 0.6 else 'high'})"


def format_account_summary(account_id: int, features: pd.DataFrame | None = None,
                           details: dict | None = None) -> tuple[str, dict]:
    """Return (summary_text, refs). refs maps a ref id to {"type", "category", "amount", "label"}.

    Raises KeyError for an unknown account.
    """
    f = features if features is not None else load_features()
    d = details if details is not None else load_details()
    acc_id = int(account_id)
    if acc_id not in f.index or acc_id not in d["accounts"].index:
        raise KeyError(f"account_id {acc_id} not found")
    p, a = f.loc[acc_id], d["accounts"].loc[acc_id]
    orders = d["orders"][d["orders"]["account_id"] == acc_id]
    payees = d["payees"][d["payees"]["account_id"] == acc_id]
    payers = d["payers"][d["payers"]["account_id"] == acc_id]
    refs: dict[str, dict] = {}
    L: list[str] = []
    add = L.append
    n = int(a["months_window"])

    add(f"ACCOUNT {acc_id}. Detail below covers the last {n} months ({a['window_start']} to {a['window_end']}); "
        f"full history is {int(p['months_history'])} months. Amounts are CAD per month unless stated.")

    add("\nJudges' numbers (full-history medians; the app computes gap and runway from these):")
    add(f"- I income {_m(p['I'])}; S spending {_m(p['S'])}; F fixed costs {_m(p['F'])} "
        f"(bills + insurance + loan); H household bills {_m(p['H'])}; P loan payment {_m(p['P'])}; "
        f"B savings buffer {_m(p['B'])} (average daily balance, last 6 months).")

    # Income
    add(f"\nIncome (12-month medians):")
    add(f"- Total money in {_m(a['med12_money_in'])}{_trend(a['med12_money_in'], a['med3_money_in'])}.")
    for col, label in [("transfers_in", "Transfers in from other banks"), ("pension_in", "Pension"),
                       ("cash_deposits", "Cash deposits"), ("interest_in", "Interest")]:
        share = a[f"inshare12_{col}"]
        if _ok(share) and share >= 0.01:
            add(f"- {label}: {_m(a[f'med12_{col}'])} ({_pct(share)} of money in).")
    add(f"- Income variability (coefficient of variation): {_variability(a['income_cv12'])}. "
        f"Lowest month {a['low_income_month']} at {_m(a['low_income_amount'])}.")
    for _, r in payers[payers["recurring"]].head(MAX_PAYERS).iterrows():
        ref = f"payer-{r['partner_account']}"
        kind = "pension" if r["purpose"] == "pension" else "regular payer"
        add(f"- [{ref}] {kind} at bank {r['partner_bank']}: typically {_m(r['median_amount'])}, "
            f"paid in {int(r['months_active'])} of {n} months, around day {int(r['typical_day'])}.")
        refs[ref] = {"type": "payer", "category": "income", "amount": float(r["monthly_avg"]), "label": kind}
    if not payers["recurring"].any():
        add("- No regular outside payer; income is irregular or comes as cash.")

    # Spending
    add(f"\nSpending (12-month medians; share = share of all money out over 12 months):")
    add(f"- Total money out {_m(a['med12_money_out'])}{_trend(a['med12_money_out'], a['med3_money_out'])}. "
        f"Highest month {a['peak_spend_month']} at {_m(a['peak_spend_amount'])}.")
    cats = [
        ("cash_withdrawals", "cash_withdrawals_genuine", "Cash withdrawals (flexible)"),
        ("card_spending", "card_withdrawals", "Card spending (flexible)"),
        ("transfers_out", "transfers_out_other", "Transfers out with no stated purpose"),
        ("household_bills", "household_bills", "Household bills"),
        ("insurance", "insurance", "Insurance"),
        ("loan_payment", "loan_payments", "Loan payments"),
        ("bank_fees", "bank_fees", "Bank fees"),
    ]
    for cat, col, label in cats:
        med, avg, share = a[f"med12_{col}"], a[f"avg12_{col}"], a[f"share12_{col}"]
        if not (_ok(share) and share > 0):
            continue
        lumpy = f", monthly average {_m(avg)}" if abs(avg - med) >= max(0.15 * abs(avg), 1) else ""
        line = (f"- {cat}: {label} median {_m(med)}{lumpy} ({_pct(share)}){_trend(med, a[f'med3_{col}'])}; "
                f"most a plan can change: {_m(category_baseline(a, col))}.")
        if cat == "cash_withdrawals" and a["cash_wd_per_month"] > 0:
            line += (f" About {a['cash_wd_per_month']:.1f} withdrawals a month, typical {_m(a['cash_wd_median'])}, "
                     f"90th percentile {_m(a['cash_wd_p90'])}, largest {_m(a['cash_wd_max'])}. "
                     f"The data does not show what cash is spent on.")
        if cat == "card_spending" and a["card_wd_per_month"] > 0:
            line += f" About {a['card_wd_per_month']:.1f} card payments a month, typical {_m(a['card_wd_median'])}."
        if cat == "bank_fees" and a["penalty_count12"] > 0:
            line += (f" Includes {int(a['penalty_count12'])} penalty-interest charges ({_m(a['penalty_total12'])} total) "
                     f"for a negative balance.")
        add(line)

    # Commitments
    lines = []
    seen_accounts = set(orders["to_account"])
    for _, o in orders.iterrows():
        ref = f"SO-{int(o['order_id'])}"
        if o["category"] == "leasing":
            lines.append(f"- [{ref}] leasing {_m(o['amount'])} to bank {o['to_bank']}. These payments do not appear "
                         f"in the recorded spending, so the app cannot count a change to them.")
            continue
        if not o["seen_in_activity"]:
            lines.append(f"- {o['purpose']} standing order {_m(o['amount'])} to bank {o['to_bank']}: not paid in the "
                         f"last {n} months, so it is not part of current spending.")
            continue
        lines.append(f"- [{ref}] {o['purpose']} standing order {_m(o['amount'])} to bank {o['to_bank']} "
                     f"(paid in {int(o['months_active'])} of {n} months).")
        refs[ref] = {"type": "standing_order", "category": o["category"], "amount": float(o["amount"]),
                     "label": o["purpose"]}
    if _ok(a["loan_loan_id"]):
        ref = f"loan-{int(a['loan_loan_id'])}"
        state = "running" if a["loan_running"] else "finished"
        line = (f"- [{ref}] loan of {_m(a['loan_amount'])} over {int(a['loan_duration_months'])} months from "
                f"{a['loan_loan_start']}, {_m(a['loan_monthly_payment'])}/month, status {a['loan_status']} "
                f"({a['loan_status_meaning']}).")
        if a["loan_running"]:
            line += (f" About {int(a['loan_months_left'])} months left; payment is "
                     f"{_pct(a['loan_payment_to_income'])} of income.")
            refs[ref] = {"type": "loan", "category": "loan_payment", "amount": float(p["P"]), "label": "loan"}
        else:
            line += f" The loan is {state}; it no longer costs anything."
        lines.append(line)
    if lines:
        add("\nCommitments (standing orders and loan):")
        L.extend(lines)

    extra = payees[~payees["partner_account"].isin(seen_accounts)]
    rec, one_off = extra[extra["recurring"]], extra[~extra["recurring"]]
    if len(rec):
        add("\nRecurring transfers out with no standing order:")
        for _, r in rec.head(MAX_PAYEES).iterrows():
            ref = f"payee-{r['partner_account']}"
            what = r["purpose"] or "no stated purpose"
            add(f"- [{ref}] to bank {r['partner_bank']}, {what}: typically {_m(r['median_amount'])}, "
                f"in {int(r['months_active'])} of {n} months (averages {_m(r['monthly_avg'])}/month).")
            cat = {"household bills": "household_bills", "insurance": "insurance",
                   "loan payment": "loan_payment"}.get(r["purpose"], "transfers_out")
            refs[ref] = {"type": "payee", "category": cat, "amount": float(r["monthly_avg"]), "label": what}
    if len(one_off):
        add("\nLargest occasional transfers out (last 12 months):")
        for _, r in one_off.sort_values("total", ascending=False).head(MAX_ONE_OFF).iterrows():
            add(f"- to bank {r['partner_bank']}: {int(r['n'])} payment(s) totalling {_m(r['total'])}.")

    # Balances and stress
    add("\nBalances and stress (last 12 months):")
    add(f"- Savings rate {_pct(a['savings_rate12'])} of money in; spending exceeded income in "
        f"{int(a['deficit_months12'])} of {n} months.")
    add(f"- Month-end balance went from {_m(a['end_balance_first'])} to {_m(a['end_balance_last'])}; "
        f"lowest balance {_m(a['min_balance12'])}; {int(a['days_below_zero12'])} days below zero.")

    # People and context
    add("\nPeople, cards and area:")
    who = f"owner age {int(p['owner_age'])}" if _ok(p["owner_age"]) else "owner age unknown"
    users = int(a["authorized_users"])
    add(f"- {who}; {users} authorized user{'s' if users != 1 else ''} on the account; "
        f"cards: {a['cards'] if _ok(a['cards']) else 'none'}; {a['statement_frequency']}.")
    add(f"- Branch district {p['district_name']} ({p['region']}): average salary {_m(a['district_avg_salary'])}/month, "
        f"unemployment {a['district_unemployment_2023']:.1f}% (2023).")

    # Points the plan must address, chosen by rules so the model does not have to spot them.
    points = []
    if p["S"] > p["I"]:
        points.append(f"Even before any event, normal spending S is above normal income I by {_m(p['S'] - p['I'])} "
                      f"a month, so the buffer is already shrinking.")
    if _ok(a["loan_loan_id"]) and a["loan_running"] and a["loan_status"] == "D":
        points.append("The running loan is in arrears (status D). Keeping it current, or talking to the lender "
                      "early, matters more than usual.")
    elif _ok(a["loan_payment_to_income"]) and a["loan_payment_to_income"] >= 0.3:
        points.append(f"The loan payment takes {_pct(a['loan_payment_to_income'])} of income.")
    if a["days_below_zero12"] > 0 or a["penalty_count12"] > 0:
        points.append(f"The balance went below zero on {int(a['days_below_zero12'])} days in 12 months"
                      + (f", costing {_m(a['penalty_total12'])} in penalty interest" if a["penalty_count12"] else "")
                      + ". Avoiding overdraft should be part of the plan.")
    if a["deficit_months12"] >= n / 2:
        points.append(f"Spending exceeded income in {int(a['deficit_months12'])} of {n} months.")
    cash_share = a["share12_cash_withdrawals_genuine"]
    if _ok(cash_share) and cash_share >= 0.5:
        points.append(f"Cash withdrawals are {_pct(cash_share)} of money out, the largest flexible category.")
    if _ok(a["income_cv12"]) and a["income_cv12"] >= 0.6:
        points.append("Income is highly variable, so plan around low months, not the median.")
    if points:
        add("\nPoints the plan should address:")
        L.extend(f"- {x}" for x in points)

    # Caveats
    caveats = []
    if p["flag_short_history"]:
        caveats.append("under 6 months of history, so the normal numbers are rough")
    if p["flag_no_income"]:
        caveats.append("no recorded income")
    if p["flag_no_bills"]:
        caveats.append("no household bills recorded; rent or utilities may be paid in cash or from another account")
    if p["flag_negative_buffer"]:
        caveats.append("the savings buffer is zero or negative")
    caveats.append("there are no merchant names; cash and unlabelled transfers cannot be broken down further")
    add("\nData caveats: " + "; ".join(caveats) + ".")
    return "\n".join(L), refs


if __name__ == "__main__":
    text, refs = format_account_summary(int(sys.argv[1]) if len(sys.argv) > 1 else 20134)
    print(text)
    print(f"\n({len(text.splitlines())} lines, {len(text)} chars) refs: {list(refs)}")
