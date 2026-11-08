"""Turn the plan actions Gemini proposes into checked amounts, exact metric changes and an engine Shock.

Pure functions, no AI. Gemini picks each action's kind, category and monthly amount; this module
- checks the kind/category pair and any cited ref id,
- caps the amount at what the account really spends on that category (caps are shared across actions),
- maps the amount to changes in the headline metrics with fixed rules, and
- folds everything into the Shock the engine scores.

Metric rules (x = checked monthly amount):
  cut_spending      cash_withdrawals, card_spending, transfers_out, bank_fees   S -x
  change_commitment household_bills                                             H -x, F -x, S -x
                    insurance                                                   F -x, S -x
                    loan_payment                                                P -x, F -x, S -x
                    transfers_out (an "other" standing order or regular payee)  S -x
  add_income        income                                                      I +x
"""
from typing import Literal

from pydantic import BaseModel, field_validator

Kind = Literal["cut_spending", "change_commitment", "add_income"]
Category = Literal[
    "cash_withdrawals", "card_spending", "transfers_out", "bank_fees",
    "household_bills", "insurance", "loan_payment", "income",
]

ALLOWED = {
    "cut_spending": {"cash_withdrawals", "card_spending", "transfers_out", "bank_fees"},
    "change_commitment": {"household_bills", "insurance", "loan_payment", "transfers_out"},
    "add_income": {"income"},
}

# Category -> monthly_summary column whose 12-month baseline caps the amount.
CAP_COLUMN = {
    "cash_withdrawals": "cash_withdrawals_genuine",
    "card_spending": "card_withdrawals",
    "transfers_out": "transfers_out_other",
    "bank_fees": "bank_fees",
    "insurance": "insurance",
}

# Which metrics move, and in which direction, per category.
METRICS = {
    "cash_withdrawals": {"S": -1}, "card_spending": {"S": -1}, "transfers_out": {"S": -1},
    "bank_fees": {"S": -1}, "household_bills": {"H": -1, "F": -1, "S": -1},
    "insurance": {"F": -1, "S": -1}, "loan_payment": {"P": -1, "F": -1, "S": -1}, "income": {"I": 1},
}

EPS = 0.5  # dollars; amounts this small count as zero


class Action(BaseModel):
    kind: Kind
    category: Category
    ref: str | None  # ref id from the account summary, e.g. "SO-842974"; null if none applies
    title: str  # short imperative, e.g. "Cut ATM cash withdrawals"
    monthly_amount: float  # dollars per month saved (cuts, commitments) or earned (income); always positive
    how: str  # concrete steps
    evidence: str  # facts from the account summary that support the action and its size
    difficulty: Literal["easy", "medium", "hard"]

    @field_validator("monthly_amount")
    @classmethod
    def _positive(cls, v):
        return abs(v)  # the sign comes from the kind; a negative amount means the same thing


def _caps(profile: dict, impact: dict, account: dict, baseline) -> dict:
    """Most each category can change, before any action uses it."""
    caps = {cat: baseline(account, col) for cat, col in CAP_COLUMN.items()}
    caps["household_bills"] = max(profile["H"] * (1 + impact["bills_pct"]), 0.0)
    caps["loan_payment"] = max(profile["P"], 0.0)
    # Income actions can only win back income lost in the event; no basis to earn more than normal.
    caps["income"] = max(profile["I"] * (1 - impact["income_multiplier"]), 0.0)
    return caps


def apply_actions(impact: dict, actions: list[Action], profile: dict, account: dict, refs: dict,
                  spending_after_impact: float) -> dict:
    """Check actions and derive the plan.

    impact: the event's shock variables (ShockVars fields). profile: I, F, S, H, P, B.
    account: the account's row from details (a mapping). refs: ref ids from summary.format_account_summary.
    spending_after_impact: monthly spending after the event; total cuts cannot exceed it.

    Returns {"actions": [...checked actions...], "variables": plan Shock fields,
             "totals": {I, F, S, H, P}, "notes": [...]}.
    """
    from .summary import category_baseline

    caps = _caps(profile, impact, account, category_baseline)
    ref_left = {k: v["amount"] for k, v in refs.items()}
    spend_left = max(spending_after_impact, 0.0)
    totals = {"I": 0.0, "F": 0.0, "S": 0.0, "H": 0.0, "P": 0.0}
    bills_cut = other_cut = extra_income = 0.0
    out, notes = [], []

    for act in actions:
        row = act.model_dump()
        row.update(requested_amount=act.monthly_amount, monthly_amount=0.0, metric_changes={}, status="ok", note=None)

        def drop(reason):
            row.update(status="dropped", note=reason)
            out.append(row)
            notes.append(f"Dropped \"{act.title}\": {reason}")

        if act.category not in ALLOWED[act.kind]:
            drop(f"{act.category} is not a valid category for {act.kind}.")
            continue
        ref = refs.get(act.ref) if act.ref else None
        if act.ref and ref is None:
            drop(f"reference {act.ref} is not in this account's data.")
            continue
        if ref and ref["type"] != "payer" and ref["category"] != act.category:
            drop(f"reference {act.ref} is a {ref['label']} payment, not {act.category}.")
            continue
        if act.kind == "add_income" and not act.evidence.strip():
            drop("an income action needs a stated basis.")
            continue

        limits = [caps[act.category]]
        if ref and ref["type"] != "payer":
            limits.append(ref_left[act.ref])
        if act.kind != "add_income":
            limits.append(spend_left)
        if act.monthly_amount < EPS:  # advice with no dollar change, e.g. "talk to your lender before you miss a payment"
            row.update(status="advice")
            out.append(row)
            continue
        amount = max(min([act.monthly_amount, *limits]), 0.0)
        if amount < EPS:
            drop(f"there is no {act.category.replace('_', ' ')} left to change in this account's data.")
            continue
        if act.monthly_amount - amount >= EPS:
            row.update(status="adjusted",
                       note=f"Reduced from ${act.monthly_amount:,.0f} to ${amount:,.0f}/month, the most this "
                            f"account's data supports for {act.category.replace('_', ' ')}.")
            notes.append(f"Adjusted \"{act.title}\": {row['note']}")

        caps[act.category] -= amount
        if ref and ref["type"] != "payer":
            ref_left[act.ref] -= amount
        if act.kind != "add_income":
            spend_left -= amount
        if act.category == "household_bills":
            bills_cut += amount
        elif act.category == "income":
            extra_income += amount
        else:
            other_cut += amount

        changes = {m: sign * amount for m, sign in METRICS[act.category].items()}
        for m, v in changes.items():
            totals[m] += v
        row.update(monthly_amount=amount, metric_changes=changes)
        out.append(row)

    variables = dict(impact)
    variables["extra_monthly"] = impact["extra_monthly"] - other_cut
    if bills_cut:
        variables["bills_pct"] = impact["bills_pct"] - bills_cut / profile["H"]  # H > 0 whenever bills_cut > 0
    variables["extra_income"] = impact.get("extra_income", 0.0) + extra_income
    return {"actions": out, "variables": variables, "totals": totals, "notes": notes}
