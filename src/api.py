"""FastAPI backend. Run from the project root: uvicorn src.api:app --reload --port 8000

All logic lives in src/service.py and src/engine.py; this file only exposes it over HTTP.
"""
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import ai
from .glossary import FLAG_TEXT, GLOSSARY
from .service import MAX_TURNS, BadConversation, follow_up, get_account, list_account_ids, plan_scenario

app = FastAPI(title="Resilience Rewired API")

# Vite dev server origins. In dev the frontend also proxies /api, so CORS is a fallback.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/glossary")
def glossary():
    return {"metrics": GLOSSARY, "flags": FLAG_TEXT}


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@app.post("/api/ai/chat")
def ai_chat(req: ChatRequest):
    """Connection check: send a plain message to Gemini and return its reply."""
    try:
        return ai.chat(req.message)
    except ai.AIUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


class PlanRequest(BaseModel):
    account_id: int
    scenario: str = Field(min_length=1, max_length=2000)


@app.post("/api/ai/plan")
def ai_plan(req: PlanRequest):
    """Typed scenario -> Gemini picks impact variables and a plan; the engine scores both."""
    try:
        return plan_scenario(req.account_id, req.scenario)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {req.account_id} not found")
    except ai.AIUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


class Turn(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(min_length=1, max_length=30_000)  # model turns are plan JSON, so they can be long


class FollowUpRequest(BaseModel):
    account_id: int
    history: list[Turn] = Field(min_length=2, max_length=MAX_TURNS)
    message: str = Field(min_length=1, max_length=2000)


@app.post("/api/ai/followup")
def ai_followup(req: FollowUpRequest):
    """A follow-up message about a plan. The AI replies, and may return a revised plan that the engine scores."""
    try:
        return follow_up(req.account_id, [t.model_dump() for t in req.history], req.message)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {req.account_id} not found")
    except BadConversation as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ai.AIUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/accounts")
def accounts(limit: int = Query(5, ge=1, le=100)):
    ids = list_account_ids()
    return {"count": len(ids), "examples": ids[:limit]}


@app.get("/api/accounts/{account_id}")
def account(
    account_id: int,
    income_multiplier: float = Query(1.0, ge=0),
    income_months: int | None = Query(None, ge=1),
    bills_pct: float = Query(0.0, ge=-1),
    one_off_cost: float = Query(0.0, ge=0),
    extra_monthly: float = Query(0.0),
    extra_income: float = Query(0.0, ge=0),
):
    shock = {
        "income_multiplier": income_multiplier,
        "income_months": income_months,
        "bills_pct": bills_pct,
        "one_off_cost": one_off_cost,
        "extra_monthly": extra_monthly,
        "extra_income": extra_income,
    }
    try:
        return get_account(account_id, shock)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")


# ---------- Guardian agent (feature/agent) ----------
from . import agent, customer  # noqa: E402

GuardrailKind = Literal[
    "cash_limit", "card_cap", "transfer_hold", "standing_order", "balance_alert", "loan_deferral", "reserve", "customer_step",
]


class Guardrail(BaseModel):
    id: str = Field(max_length=40)
    kind: GuardrailKind
    label: str = Field(max_length=200)
    amount: float = Field(0, ge=0)


class AgentRequest(BaseModel):
    account_id: int
    guardrail: Guardrail
    instruction: str | None = Field(None, max_length=500)  # extra request, e.g. the "try to break it" demo
    undo: bool = False
    simulate_attack: bool = False  # demo: inject forbidden tool calls to show the rule checker refusing them
    shock: dict | None = None  # the shock in effect on the engine page, so the customer sandbox uses the same runway


@app.post("/api/agent/apply")
def agent_apply(req: AgentRequest):
    """The Guardian carries out (or undoes) one approved guardrail on the sandbox account; every tool call is rule-checked."""
    g = req.guardrail.model_dump()
    if req.shock is not None:
        customer.set_context(req.account_id, req.shock)
    if req.undo:
        return agent.undo_guardrail(req.account_id, g)
    return agent.apply_guardrail(req.account_id, g, req.instruction, req.simulate_attack)


# ---------- Customer sandbox: act as the customer and spend (feature/agent) ----------
class PurchaseRequest(BaseModel):
    account_id: int
    merchant: str = Field(min_length=1, max_length=80)
    category: str = Field("", max_length=60)
    amount: float = Field(gt=0, le=1_000_000)


class ResolveRequest(BaseModel):
    account_id: int
    hold_id: str = Field(max_length=20)
    approve: bool
    code: str | None = Field(None, max_length=8)


@app.get("/api/customer/{account_id}")
def customer_state(account_id: int):
    try:
        return customer.public_state(account_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")


@app.post("/api/customer/purchase")
def customer_purchase(req: PurchaseRequest):
    """Spend on the sandbox card. Guardrail limits apply, and the agent judges whether it's necessary."""
    try:
        return customer.purchase(req.account_id, req.merchant, req.category, req.amount)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {req.account_id} not found")


@app.post("/api/customer/resolve")
def customer_resolve(req: ResolveRequest):
    """Approve a held purchase with its code, or cancel it."""
    return customer.resolve(req.account_id, req.hold_id, req.code, req.approve)


@app.post("/api/customer/{account_id}/reset")
def customer_reset(account_id: int):
    return customer.reset(account_id)


# ---------- PayPal sandbox checkout for the demo stores (feature/agent) ----------
from . import paypal  # noqa: E402


class PayPalItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price: float = Field(gt=0, le=100_000)
    qty: int = Field(ge=1, le=99)


class PayPalOrderRequest(BaseModel):
    account_id: int
    store: str = Field(max_length=40)
    store_name: str = Field(max_length=80)
    items: list[PayPalItem] = Field(min_length=1, max_length=50)


class PayPalApprovedRequest(BaseModel):
    account_id: int
    order_id: str = Field(max_length=40)
    store_name: str = Field(max_length=80)
    category: str = Field("", max_length=40)


@app.get("/api/paypal/config")
def paypal_config():
    """The public client ID for the PayPal buttons (never the secret)."""
    return {"enabled": paypal.enabled(), "client_id": paypal.client_id() if paypal.enabled() else None}


@app.post("/api/paypal/order")
def paypal_order(req: PayPalOrderRequest):
    if not paypal.enabled():
        raise HTTPException(status_code=503, detail="PayPal is not configured")
    return {"id": paypal.create_order(req.store, req.store_name, [i.model_dump() for i in req.items])}


@app.post("/api/paypal/approved")
def paypal_approved(req: PayPalApprovedRequest):
    """The shopper approved in PayPal. Read the order from PayPal (payee, items, total), let the guardrails
    judge it, then capture it or hold it uncaptured until the shopper enters the code."""
    if not paypal.enabled():
        raise HTTPException(status_code=503, detail="PayPal is not configured")
    order = paypal.summary(paypal.get_order(req.order_id))
    if order["status"] != "APPROVED":
        raise HTTPException(status_code=409, detail=f"Order is {order['status']}, not approved")
    category = f"{req.category}: {', '.join(order['items'])}"[:60]
    out = customer.purchase(req.account_id, req.store_name, category, order["amount"], mode="nudge", paypal=order)
    out["paypal"] = order
    return out
