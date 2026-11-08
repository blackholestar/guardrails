"""Guardian agent: carries out an approved guardrail with tools, on a sandbox copy of the account.

One agent (Gemini with function calling). It may only *change settings*; it never moves money to anyone
or blocks an essential payment. Those rules are enforced here in code, on every tool call, not by the prompt:

1. Least privilege: the agent is only *given* settings tools. It has no tool that moves money or cancels a payment.
   As a second layer, any call to a tool outside the allowlist (an invented or injected one) is refused and logged.
2. Scope: a call must belong to the guardrail the customer approved (a cash-limit approval can't touch the loan).
3. Amount: never more than the customer approved.
4. Essentials: holds never apply to rent, bills, insurance or loan payments.
5. Everything is logged, applied or refused, with the reason.

If Gemini is unavailable, the guardrail is applied directly with its default tool and the log says so.
"""
from __future__ import annotations

import time

from . import ai

SANDBOX: dict[int, dict] = {}  # account_id -> {"settings": {...}, "log": [...]}

# guardrail kind -> tools that may carry it out
KIND_TOOLS = {
    "cash_limit": {"set_cash_limit"},
    "card_cap": {"set_card_cap"},
    "transfer_hold": {"hold_transfers_over"},
    "standing_order": {"pause_standing_order"},
    "balance_alert": {"set_balance_alert"},
    "loan_deferral": {"request_loan_deferral"},
    "reserve": {"schedule_reserve_transfer"},
    "customer_step": {"notify_customer"},
}
ALWAYS_OK = {"notify_customer"}
ALLOWLIST = {n for tools in KIND_TOOLS.values() for n in tools}
# Reasons shown if anything ever tries these (the agent is not given them).
FORBIDDEN = {
    "send_payment": "The agent has no payment tool. Guardrails only change settings, never move money.",
    "cancel_payment": "The agent has no tool to cancel payments. Essentials (rent, bills, insurance, loans) always go through.",
}
ESSENTIAL_WORDS = ("rent", "bill", "insurance", "loan", "mortgage", "utilit", "hydro")

_num = {"type": "NUMBER"}
_str = {"type": "STRING"}
TOOL_SPECS = [
    ("set_cash_limit", "Lower the customer's monthly ATM/cash withdrawal allowance by an amount.", {"monthly_reduction": _num}),
    ("set_card_cap", "Cap monthly card spending, lowering it by an amount.", {"monthly_reduction": _num}),
    ("hold_transfers_over", "Outgoing transfers above a threshold wait for the customer's approval.", {"threshold": _num}),
    ("pause_standing_order", "Pause a non-essential standing order worth a monthly amount.", {"monthly_amount": _num}),
    ("set_balance_alert", "Alert the customer when the balance falls below a threshold.", {"threshold": _num}),
    ("request_loan_deferral", "Send the lender a request to defer the loan payment. The lender decides.",
     {"months": _num, "monthly_amount": _num}),
    ("schedule_reserve_transfer", "Move money between the customer's OWN accounts into a reserve each month.",
     {"monthly_amount": _num}),
    ("notify_customer", "Send the customer a message (e.g. a reminder for a step only they can take).", {"message": _str}),
]  # deliberately no payment or cancellation tools

DEFAULT_CALL = {
    "cash_limit": lambda g: ("set_cash_limit", {"monthly_reduction": g["amount"]}),
    "card_cap": lambda g: ("set_card_cap", {"monthly_reduction": g["amount"]}),
    "transfer_hold": lambda g: ("hold_transfers_over", {"threshold": 500}),
    "standing_order": lambda g: ("pause_standing_order", {"monthly_amount": g["amount"]}),
    "balance_alert": lambda g: ("set_balance_alert", {"threshold": 500}),
    "loan_deferral": lambda g: ("request_loan_deferral", {"months": 3, "monthly_amount": g["amount"]}),
    "reserve": lambda g: ("schedule_reserve_transfer", {"monthly_amount": g["amount"]}),
    "customer_step": lambda g: ("notify_customer", {"message": f"Reminder: {g['label']}"}),
}


def _box(account_id: int) -> dict:
    return SANDBOX.setdefault(account_id, {"settings": {}, "log": []})


def check(call: str, args: dict, guardrail: dict) -> str | None:
    """Return None if the call may run, else the reason it is refused."""
    if call in FORBIDDEN:
        return FORBIDDEN[call]
    if call not in ALLOWLIST:
        return f"'{call}' is not a tool the agent has."
    allowed = KIND_TOOLS.get(guardrail["kind"], set())
    if call not in allowed and call not in ALWAYS_OK:
        return f"Not part of the approved guardrail ({guardrail['label']})."
    approved = float(guardrail.get("amount") or 0)
    for k in ("monthly_reduction", "monthly_amount"):
        if k in args and approved and float(args[k]) > approved + 0.5:
            return f"${float(args[k]):,.0f} is more than the ${approved:,.0f} the customer approved."
    text = " ".join(str(v) for v in args.values()).lower()
    if call == "hold_transfers_over" and any(w in text for w in ESSENTIAL_WORDS):
        return "Holds never apply to essential payments."
    return None


def _apply(box: dict, call: str, args: dict) -> str:
    s = box["settings"]
    if call == "set_cash_limit":
        s["cash_limit_reduction"] = args["monthly_reduction"]
        return f"Cash allowance lowered by ${args['monthly_reduction']:,.0f}/month"
    if call == "set_card_cap":
        s["card_cap_reduction"] = args["monthly_reduction"]
        return f"Card spending capped ${args['monthly_reduction']:,.0f}/month lower"
    if call == "hold_transfers_over":
        s["transfer_hold_over"] = args["threshold"]
        return f"Transfers over ${args['threshold']:,.0f} now need the customer's approval"
    if call == "pause_standing_order":
        s["paused_order"] = args["monthly_amount"]
        return f"Standing order of ${args['monthly_amount']:,.0f}/month paused"
    if call == "set_balance_alert":
        s["balance_alert_below"] = args["threshold"]
        return f"Alert set for balance below ${args['threshold']:,.0f}"
    if call == "request_loan_deferral":
        s["loan_deferral"] = {"months": args.get("months", 3), "status": "requested"}
        m = int(args.get("months", 3))
        return f"Deferral request sent to the lender ({m} month{'' if m == 1 else 's'}). Waiting for approval"
    if call == "schedule_reserve_transfer":
        s["reserve_transfer"] = args["monthly_amount"]
        return f"${args['monthly_amount']:,.0f}/month moves to the reserve on payday"
    if call == "notify_customer":
        from .notify import push
        sent = push(str(args.get("message", "")), title="Guardrails", tags="bell")
        return f"Message sent{' to the phone' if sent else ''}: “{args.get('message', '')}”"
    return "Done"


def _ask_gemini(guardrail: dict, instruction: str | None) -> list[tuple[str, dict]]:
    from google.genai import types

    decls = [
        types.FunctionDeclaration(name=n, description=d, parameters={"type": "OBJECT", "properties": p, "required": list(p)})
        for n, d, p in TOOL_SPECS
    ]
    prompt = (
        "You are the Guardian agent at a bank. The customer approved this guardrail:\n"
        f"- {guardrail['label']} (kind: {guardrail['kind']}, approved amount: ${float(guardrail.get('amount') or 0):,.0f}/month)\n"
        "Carry it out by calling the right tool(s). Use the approved amount. "
        "If it is a step only the customer can take, send them a short, friendly reminder with notify_customer."
    )
    if instruction:
        prompt += f"\nAdditional request: {instruction}"
    try:
        resp = ai._get_client().models.generate_content(
            model=ai._model(),
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(function_declarations=decls)],
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
    except ai.AIUnavailable:
        raise
    except Exception as e:  # never leak request details
        raise ai.AIUnavailable(f"Gemini request failed ({type(e).__name__}).") from e
    return [(fc.name, dict(fc.args or {})) for fc in (resp.function_calls or [])]


def apply_guardrail(account_id: int, guardrail: dict, instruction: str | None = None, simulate_attack: bool = False) -> dict:
    """Run the Guardian on one approved guardrail. Returns {"source", "events", "settings"}."""
    box = _box(account_id)
    try:
        calls = _ask_gemini(guardrail, instruction)
        source = "gemini"
        if not calls:
            calls = [DEFAULT_CALL[guardrail["kind"]](guardrail)]
            source = "gemini (no tool call; default applied)"
    except ai.AIUnavailable:
        calls = [DEFAULT_CALL[guardrail["kind"]](guardrail)]
        source = "rules (AI unavailable)"
    injected = []
    if simulate_attack:
        # Safety test: pretend something tried calls the agent was never given, or too big. The checker must refuse them.
        injected = [
            ("send_payment", {"amount": 5000, "to_account": "99-1234 (another bank)", "memo": "simulated attack"}),
            ("cancel_payment", {"payee": "rent"}),
            ("set_cash_limit", {"monthly_reduction": float(guardrail.get("amount") or 0) * 3 + 1000}),
        ]
    events = []
    for i, (name, args) in enumerate(calls + injected):
        reason = check(name, args, guardrail)
        ev = {"t": time.time(), "tool": name, "args": args, "simulated": i >= len(calls)}
        if reason:
            ev.update(status="refused", detail=reason)
        else:
            ev.update(status="applied", detail=_apply(box, name, args))
        events.append(ev)
        box["log"].append(ev)
    return {"source": source, "events": events, "settings": box["settings"]}


def undo_guardrail(account_id: int, guardrail: dict) -> dict:
    box = _box(account_id)
    key = {
        "cash_limit": "cash_limit_reduction", "card_cap": "card_cap_reduction", "transfer_hold": "transfer_hold_over",
        "standing_order": "paused_order", "balance_alert": "balance_alert_below", "loan_deferral": "loan_deferral",
        "reserve": "reserve_transfer",
    }.get(guardrail["kind"])
    if key:
        box["settings"].pop(key, None)
    ev = {"t": time.time(), "tool": "undo", "args": {}, "status": "applied", "detail": f"Undone by the customer: {guardrail['label']}"}
    box["log"].append(ev)
    return {"source": "customer", "events": [ev], "settings": box["settings"]}
