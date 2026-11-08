"""PayPal sandbox checkout for the demo stores (feature/agent).

Flow: the store creates an order (intent CAPTURE), the shopper approves it in PayPal's popup, then the
backend looks at the approved order: who the payee is, what the items are. Small or necessary purchases
are captured at once and, if discretionary, followed by a nudge message. Large discretionary ones are
left approved but uncaptured (a real hold) until the shopper enters the code; capturing is plain code
triggered by the shopper, never a tool the AI agent can call.

Credentials come from .env: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (or PAYPAL_APP_*) (a REST app in the developer
dashboard, sandbox). Optional PAYPAL_VOLT_PAYEE: a second sandbox business email so Volt's orders go
to a different merchant.
"""
from __future__ import annotations

import os
import time

import httpx

BASE = "https://api-m.sandbox.paypal.com"
_token: dict = {"value": None, "exp": 0.0}


def client_id() -> str | None:
    return os.environ.get("PAYPAL_APP_CLIENT_ID") or os.environ.get("PAYPAL_CLIENT_ID") or None


def enabled() -> bool:
    return bool(client_id() and _secret() and "@" not in client_id())  # an email here is a login, not an app key


def _auth() -> dict:
    if not _token["value"] or time.time() > _token["exp"]:
        r = httpx.post(f"{BASE}/v1/oauth2/token", auth=(client_id(), _secret()),
                       data={"grant_type": "client_credentials"}, timeout=20)
        r.raise_for_status()
        d = r.json()
        _token.update(value=d["access_token"], exp=time.time() + d["expires_in"] - 60)
    return {"Authorization": f"Bearer {_token['value']}", "Content-Type": "application/json"}


def create_order(store: str, store_name: str, items: list[dict]) -> str:
    total = round(sum(i["price"] * i["qty"] for i in items), 2)
    unit = {
        "reference_id": store,
        "description": f"{store_name} (demo store)",
        "amount": {"currency_code": "CAD", "value": f"{total:.2f}",
                   "breakdown": {"item_total": {"currency_code": "CAD", "value": f"{total:.2f}"}}},
        "items": [{"name": i["name"][:127], "quantity": str(i["qty"]), "category": "PHYSICAL_GOODS",
                   "unit_amount": {"currency_code": "CAD", "value": f"{i['price']:.2f}"}} for i in items],
    }
    payee = os.environ.get("PAYPAL_VOLT_PAYEE") if store == "volt" else None
    if payee:
        unit["payee"] = {"email_address": payee}
    r = httpx.post(f"{BASE}/v2/checkout/orders", headers=_auth(), timeout=20,
                   json={"intent": "CAPTURE", "purchase_units": [unit]})
    r.raise_for_status()
    return r.json()["id"]


def get_order(order_id: str) -> dict:
    r = httpx.get(f"{BASE}/v2/checkout/orders/{order_id}", headers=_auth(), timeout=20)
    r.raise_for_status()
    return r.json()


def capture(order_id: str) -> dict:
    r = httpx.post(f"{BASE}/v2/checkout/orders/{order_id}/capture", headers=_auth(), timeout=20, json={})
    r.raise_for_status()
    return r.json()


def summary(order: dict) -> dict:
    """What PayPal tells us about an order: the verified payee, the items and the total."""
    u = order["purchase_units"][0]
    payee = u.get("payee") or {}
    return {
        "order_id": order["id"],
        "status": order["status"],
        "merchant_id": payee.get("merchant_id"),
        "payee_email": payee.get("email_address"),
        "amount": float(u["amount"]["value"]),
        "items": [f"{i['quantity']}× {i['name']}" for i in u.get("items", [])],
    }


def _secret() -> str | None:
    return os.environ.get("PAYPAL_APP_SECRET") or os.environ.get("PAYPAL_CLIENT_SECRET") or os.environ.get("PAYPAL_SECRET_ID") or None
