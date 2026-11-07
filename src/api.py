"""FastAPI backend. Run from the project root: uvicorn src.api:app --reload --port 8000

All logic lives in src/service.py and src/engine.py; this file only exposes it over HTTP.
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .glossary import FLAG_TEXT, GLOSSARY
from .service import get_account, list_account_ids

app = FastAPI(title="Resilience Rewired API")

# Vite dev server origins. In dev the frontend also proxies /api, so CORS is a fallback.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/glossary")
def glossary():
    return {"metrics": GLOSSARY, "flags": FLAG_TEXT}


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
):
    shock = {
        "income_multiplier": income_multiplier,
        "income_months": income_months,
        "bills_pct": bills_pct,
        "one_off_cost": one_off_cost,
        "extra_monthly": extra_monthly,
    }
    try:
        return get_account(account_id, shock)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
