"""Customer sandbox: act as the customer, spend on their card, and watch the guardrails respond.

Every purchase goes through two checks:
1. Hard limits the Guardian agent set (cash allowance, card cap, transfer hold), using the account's real
   12-month medians from monthly_summary.csv as the normal monthly amount.
2. The agent's judgment (Gemini): is this purchase necessary or discretionary? Essentials always go through.
   Discretionary purchases that cost real runway are held, and the customer gets a message with a code to approve.

Messages are shown in the customer page for now (a stand-in for SMS).
"""
from __future__ import annotations

import random
import time
from functools import lru_cache

import pandas as pd

from . import ai
from .agent import SANDBOX, _box
from .features import DATA_DIR
from .service import get_account

ESSENTIAL_WORDS = (
    "rent", "mortgage", "hydro", "electric", "utilit", "water", "heating", "insurance", "phone bill", "internet",
    "bill", "loan", "grocer", "supermarket", "pharmac", "prescription", "daycare", "tuition", "transit", "gas station",
)
SMALL = 40  # dollars; anything this small just goes through


@lru_cache(maxsize=1)
def _medians() -> pd.DataFrame:
    m = pd.read_csv(DATA_DIR / "monthly_summary.csv", usecols=["account_id", "month", "cash_withdrawals_genuine", "card_withdrawals"])
    m = m.sort_values(["account_id", "month"]).groupby("account_id").tail(12)
    return m.groupby("account_id")[["cash_withdrawals_genuine", "card_withdrawals"]].median()


def _state(account_id: int) -> dict:
    box = _box(account_id)
    if "card" not in box:
        acct = get_account(account_id)
        med = _medians().loc[account_id] if account_id in _medians().index else None
        box["card"] = {
            "balance": round(float(acct["profile"]["B"]), 2),
            "cash_normal": float(med["cash_withdrawals_genuine"]) if med is not None else 0.0,
            "card_normal": float(med["card_withdrawals"]) if med is not None else 0.0,
            "cash_used": 0.0,
            "card_used": 0.0,
            "spent": 0.0,
        }
        box.setdefault("messages", [])
        box.setdefault("holds", {})
        box.setdefault("purchases", [])
        box.setdefault("shock", {})
    return box


def set_context(account_id: int, shock: dict) -> None:
    """The engine page tells the sandbox which shock is in effect, so messages use the right runway."""
    _state(account_id)["shock"] = shock or {}


def _runway(account_id: int, box: dict, extra_spend: float = 0.0) -> float:
    s = dict(box.get("shock") or {})
    settings = box["settings"]
    saving = float(settings.get("cash_limit_reduction", 0)) + float(settings.get("card_cap_reduction", 0)) + float(
        settings.get("paused_order", 0)
    )
    if settings.get("loan_deferral"):
        saving += float(get_account(account_id)["profile"].get("P") or 0)
    s["extra_monthly"] = float(s.get("extra_monthly", 0)) - saving
    s["one_off_cost"] = float(s.get("one_off_cost", 0)) + box["card"]["spent"] + extra_spend
    allowed = {"income_multiplier", "income_months", "bills_pct", "one_off_cost", "extra_monthly", "extra_income"}
    return float(get_account(account_id, {k: v for k, v in s.items() if k in allowed})["shocked"]["runway_months"])


def _judge(merchant: str, category: str, amount: float) -> dict:
    """Ask the agent whether the purchase is necessary. Falls back to simple rules."""
    text = f"{merchant} {category}".lower()
    if any(w in text for w in ESSENTIAL_WORDS):
        return {"necessary": True, "reason": "Essential spending.", "source": "rules"}
    try:
        from google.genai import types

        schema = {
            "type": "OBJECT",
            "properties": {"necessary": {"type": "BOOLEAN"}, "reason": {"type": "STRING"}},
            "required": ["necessary", "reason"],
        }
        prompt = (
            "You review card purchases for a bank customer who is protecting their savings. Decide if this purchase is a "
            "necessity (food, housing, utilities, health, transport to work, childcare, debt payments) or discretionary "
            "(electronics, entertainment, eating out, luxury, gambling, impulse shopping). Reason in at most 12 words.\n"
            f"Purchase: ${amount:,.2f} at {merchant} (category: {category})."
        )
        resp = ai._get_client().models.generate_content(
            model=ai._model(),
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema),
        )
        import json

        out = json.loads(resp.text)
        return {"necessary": bool(out["necessary"]), "reason": str(out["reason"])[:140], "source": "gemini"}
    except Exception:
        discretionary = any(w in text for w in ("electronic", "game", "concert", "ticket", "restaurant", "bar", "casino", "fashion", "shoe", "jewel", "luxury", "toy"))
        return {"necessary": not discretionary, "reason": "Looks discretionary." if discretionary else "Looks routine.", "source": "rules"}


def _month(after: float) -> str:
    d = pd.Timestamp("2026-11-08") + pd.Timedelta(days=round(after * 30.4))
    return d.strftime("%B %Y")


def _message(merchant: str, amount: float, before: float, after: float, goal: float, P: float) -> str:
    days = max(round((before - after) * 30.4), 1)
    lines = [
        f"Hold on. ${amount:,.0f} at {merchant} is {days} day{'s' if days != 1 else ''} of runway. "
        + (f"Your savings would run out in {_month(after)} instead of {_month(before)}." if _month(after) != _month(before)
           else f"Your savings would run out {days} day{'s' if days != 1 else ''} sooner, still in {_month(after)}."),
        f"Heads up: at this rate your ${P:,.0f} loan payment starts bouncing around {_month(after)}. Your lender does not accept {merchant} gift cards."
        if P
        else f"At this rate you're out of money by {_month(after)}. {merchant} will still be there next month. Will your savings?",
        f"Your goal is {goal:.0f} months of runway. After this you'd have {after:.1f}. Future you asked us to say no, politely."
        if after < goal
        else f"You'd still clear your {goal:.0f}-month goal, but only by {after - goal:.1f} months. Living dangerously.",
    ]
    return lines[(round(amount) + len(merchant)) % len(lines)]


def _say(box: dict, text: str, kind: str = "info", **extra) -> dict:
    msg = {"id": f"m{len(box['messages']) + 1}", "t": time.time(), "kind": kind, "text": text, **extra}
    box["messages"].append(msg)
    return msg


def purchase(account_id: int, merchant: str, category: str, amount: float) -> dict:
    box = _state(account_id)
    card, settings = box["card"], box["settings"]
    is_cash = "atm" in f"{merchant} {category}".lower() or "cash" in category.lower()

    # 1. hard limits the agent set
    limit_reason = None
    if is_cash and settings.get("cash_limit_reduction"):
        allowance = max(card["cash_normal"] - float(settings["cash_limit_reduction"]), 0)
        if card["cash_used"] + amount > allowance:
            limit_reason = f"Over your cash allowance (${allowance:,.0f} this month, ${card['cash_used']:,.0f} used)."
    if not is_cash and settings.get("card_cap_reduction"):
        cap = max(card["card_normal"] - float(settings["card_cap_reduction"]), 0)
        if card["card_used"] + amount > cap:
            limit_reason = f"Over your card cap (${cap:,.0f} this month, ${card['card_used']:,.0f} used)."

    # 2. the agent's judgment on necessity (cash can't be judged: only the cash limit applies to it)
    verdict = (
        {"necessary": True, "reason": "Cash withdrawal: only the cash limit applies.", "source": "rules"}
        if is_cash
        else _judge(merchant, category, amount)
    )
    before = _runway(account_id, box)
    after = _runway(account_id, box, amount)
    goal = float((box.get("shock") or {}).get("income_months") or 6)
    P = float(get_account(account_id)["profile"].get("P") or 0) if not settings.get("loan_deferral") else 0.0

    hold = False
    if verdict["necessary"] and not (is_cash and limit_reason):
        hold = False
    elif limit_reason:
        hold = True
    elif amount > SMALL and not verdict["necessary"]:
        hold = (before - after) >= 0.05 or after < goal

    entry = {"id": f"p{len(box['purchases']) + 1}", "t": time.time(), "merchant": merchant, "category": category,
             "amount": amount, "necessary": verdict["necessary"], "reason": verdict["reason"], "judge": verdict["source"]}
    if not hold:
        _settle(box, entry, is_cash)
        _say(box, f"Approved: ${amount:,.2f} at {merchant}.", "ok")
        return {"status": "approved", "purchase": entry, "state": public_state(account_id)}

    code = f"{random.randint(0, 9999):04d}"
    entry.update(status="held", code=code, is_cash=is_cash)
    box["holds"][entry["id"]] = entry
    box["purchases"].append(entry)
    why = limit_reason or verdict["reason"]
    _say(box, _message(merchant, amount, before, after, goal, P), "hold", hold_id=entry["id"], why=why)
    _say(box, f"To approve anyway, enter code {code}. Reply STOP to cancel it.", "code", hold_id=entry["id"])
    return {"status": "held", "purchase": {k: v for k, v in entry.items() if k != "code"}, "state": public_state(account_id)}


def _settle(box: dict, entry: dict, is_cash: bool) -> None:
    card = box["card"]
    card["balance"] = round(card["balance"] - entry["amount"], 2)
    card["spent"] += entry["amount"]
    card["cash_used" if is_cash else "card_used"] += entry["amount"]
    entry["status"] = "approved"
    if entry not in box["purchases"]:
        box["purchases"].append(entry)


def resolve(account_id: int, hold_id: str, code: str | None, approve: bool) -> dict:
    box = _state(account_id)
    entry = box["holds"].get(hold_id)
    if not entry:
        return {"status": "unknown", "state": public_state(account_id)}
    if not approve:
        entry["status"] = "cancelled"
        box["holds"].pop(hold_id)
        _say(box, f"Cancelled: ${entry['amount']:,.2f} at {entry['merchant']}. Nice. Future you says thanks.", "ok")
        return {"status": "cancelled", "state": public_state(account_id)}
    if (code or "").strip() != entry["code"]:
        _say(box, "That code doesn't match. The purchase is still on hold.", "warn")
        return {"status": "wrong_code", "state": public_state(account_id)}
    box["holds"].pop(hold_id)
    _settle(box, entry, entry.get("is_cash", False))
    entry["status"] = "approved anyway"
    _say(box, f"Approved anyway: ${entry['amount']:,.2f} at {entry['merchant']}. We'll keep an eye on things.", "ok")
    return {"status": "approved", "state": public_state(account_id)}


def public_state(account_id: int) -> dict:
    box = _state(account_id)
    card = box["card"]
    s = box["settings"]
    limits = []
    if s.get("cash_limit_reduction"):
        limits.append(f"Cash allowance ${max(card['cash_normal'] - s['cash_limit_reduction'], 0):,.0f}/month (lowered by ${s['cash_limit_reduction']:,.0f})")
    if s.get("card_cap_reduction"):
        limits.append(f"Card spending cap ${max(card['card_normal'] - s['card_cap_reduction'], 0):,.0f}/month")
    if s.get("transfer_hold_over"):
        limits.append(f"Transfers over ${s['transfer_hold_over']:,.0f} need your OK")
    if s.get("balance_alert_below"):
        limits.append(f"Alert if balance falls below ${s['balance_alert_below']:,.0f}")
    if s.get("loan_deferral"):
        limits.append("Loan deferral requested")
    if s.get("reserve_transfer"):
        limits.append(f"${s['reserve_transfer']:,.0f}/month to your reserve")
    try:
        runway = _runway(account_id, box)
    except Exception:
        runway = None
    return {
        "account_id": account_id,
        "balance": card["balance"],
        "runway": runway,
        "limits": limits,
        "messages": box["messages"][-30:],
        "holds": [{k: v for k, v in h.items() if k != "code"} for h in box["holds"].values()],
        "purchases": [{k: v for k, v in p.items() if k != "code"} for p in box["purchases"][-12:]],
    }


def reset(account_id: int) -> dict:
    SANDBOX.pop(account_id, None)
    return public_state(account_id)
