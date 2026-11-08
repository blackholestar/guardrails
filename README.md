# Guardrails

**Sheridan Datathon 2026 · Tangerine track, "Resilience Rewired"**

Guardrails is a financial resilience engine for real bank customers. Pick any of the 4,500 accounts, hit it
with a shock (a layoff on EI, higher bills, a surprise repair), and it shows how many months the customer's
savings last. Gemini then writes a plan from the customer's own transactions, the engine checks every number
with the judges' formula, and each step of the plan becomes a **guardrail** that an AI agent can switch on
for the customer: a lower cash limit, a loan deferral request, a low-balance alert.

The idea is a highway guardrail: it does not drive for you, it keeps you on the road. Essentials always go
through, the customer approves every guardrail, and the agent can never move money.

The challenge brief and data dictionary are in [`data/README.md`](data/README.md).

---

## What it does

The brief asks for three things. Guardrails does all three, then acts on the plan.

| Brief | In the app |
|---|---|
| **1. Know the customer** | Income (I), spending (S), household bills (H), loan payment (P), fixed costs (F), savings (B), the monthly gap, and months of runway, all with the judges' definitions. |
| **2. Take a shock** | Type a twist card in plain English ("Laid off, EI pays 55% for 6 months and bills go up 15%") and Gemini reads it into shock variables, or use the presets and sliders. Runway recalculates instantly. |
| **3. Make a plan** | Gemini writes a plan grounded in the account's own records. Code checks every action against the data, caps amounts at what the customer really spends, and the engine computes the months it buys. |
| **…and do something** | Each plan step becomes a guardrail. One click and the Guardian agent applies it to a sandbox account using tools, under rules enforced in code. |

### The pages

| Route | Page |
|---|---|
| `#/` | **The story.** A 3D guardrail built in three.js. Scroll (or use the arrow keys) through six chapters that tell one customer's story with real numbers, then enter any account to open the engine. |
| `#/engine?account=ID` | **The engine.** The dashboard: the customer strip, runway, the months-of-savings track, the shock, the plan, the guardrails, and the agent's activity log. |
| `#/shop/fresh-basket?account=ID` | **Fresh Basket**, a demo grocery store (necessities). |
| `#/shop/volt?account=ID` | **Volt**, a demo electronics store (not necessary). |
| `#/findings` | Our findings (in progress). |

### A run through the demo
1. Open the engine, enter an account (try **20111**) and a twist card, press **Go**.
2. Read the runway after the shock and Gemini's plan, with the engine-checked months it buys.
3. Click **Why this →** on a guardrail. The dashboard slides away and an explainer slides in with three
   charts: the customer's own last 12 months, the population finding behind that guardrail, and runway
   before vs after.
4. Click the guardrail. The agent applies it; the step lands in **Agent activity**.
5. Click **Shop as this customer → Volt** and buy the TV. The payment goes through, the agent flags it as
   overspending, the log shows why, and the customer's phone gets a heads-up. Groceries at Fresh Basket go
   through as necessary spending with no message.

---

## How it works

```
 monthly_summary.csv ─┐
 transactions.csv ────┼─► features.py / details.py ─► summary.py ──► Gemini (ai.py) ──► actions.py ──► engine.py
 loans.csv ───────────┘   per-account numbers          fact sheet     plan as JSON        checks & caps   runway
                                                       + our findings                                     (judges' formula)
                                                                                              │
                                                                                              ▼
                                                     guardrails ──► Guardian agent (agent.py) ──► sandbox account
                                                                    Gemini + tools, rule-checked      │
                                                                                                      ▼
                                                     demo stores ──► customer.py ──► necessity check ──► Agent activity
                                                     (card or PayPal)                (Gemini)            + phone alert
```

**1. The numbers are deterministic code.** `src/engine.py` implements the judges' definitions exactly:
`buffer_left = B − one_off`, `gap = spending − income`, `runway = min(buffer_left / gap, 120)`. Gemini never
does arithmetic. The browser copy (`frontend/src/runway.js`) mirrors it so sliders respond instantly.

**2. Gemini reads a fact sheet, not raw data.** `src/summary.py` turns each account into plain text: the
core figures, 12 months of spending by category, standing orders and the loan (each with a ref id such as
`[loan-906277]`), income sources, warning signs, and points the plan must address. The prompt also carries
our population findings (`docs/insights/`) so Gemini knows which levers matter.

**3. Every action is checked.** Gemini returns structured JSON: the shock, then actions with a category, a
monthly amount, steps and quoted evidence. `src/actions.py` drops any action whose category or ref id is not
in the account, caps amounts at real spending, and only then does the engine score it.

**4. Guardrails are carried out by an agent with least privilege.** `src/agent.py` gives Gemini a short list
of tools: `set_cash_limit`, `set_card_cap`, `hold_transfers_over`, `pause_standing_order`,
`set_balance_alert`, `request_loan_deferral`, `schedule_reserve_transfer`, `notify_customer`. There are
deliberately **no payment or cancellation tools**. Before any call runs, code checks that the tool is allowed
for that guardrail, the amount is within what the customer approved, and essentials are never blocked.

**5. Purchases are judged, never blocked.** In the demo stores, every payment goes through. `src/customer.py`
asks Gemini whether it is necessary (with keyword rules as a fallback). Discretionary spending that costs the
customer runway is logged as overspending and triggers a heads-up to their phone.

**6. Real rails where we can.** PayPal checkout runs in the PayPal sandbox: the backend creates the order,
reads it back from PayPal (payee, items, total) and captures it, so the merchant is verified by PayPal, not
by the store. Phone alerts go out as push notifications through [ntfy](https://ntfy.sh).

---

## Findings

Full detail, code and caveats: [`findings/README.md`](findings/README.md) and
[`findings/findings_walkthrough.ipynb`](findings/findings_walkthrough.ipynb).
How we found them, step by step (the first plots, the surprises, and a lead we dropped):
[`eda/eda.ipynb`](eda/eda.ipynb). Run it from the `eda/` folder with the project venv.

- **The stress test predicts real trouble.** Runway if laid off, computed from 2024 data, against who was
  really overdrawn in 2025 (3,657 accounts): under 3 months, 17.7% overdrawn; 12+ months, 1.1%.
  AUC 0.78, vs 0.67 for plain runway.
- **Near-misses predict crashes; income does not.** The lowest balance in the past 12 months predicts a 2025
  overdraft with AUC 0.90 (0.81 among accounts never overdrawn before). Income level: AUC 0.45.
- **Two warning signs for loan default.** Unsteady income (odds ratio 4.7 [2.5–8.8]) and a balance dip below
  $500 (4.9 [2.7–8.8]), controlling for income, savings and loan size. Income level is not significant.
- **Higher earners are less resilient to a job loss**, because their savings cover fewer months of spending.
- **A near-miss gives about a year's warning.** 64% of overdrawn accounts first had a balance between $0 and
  $500; the overdraft came a median 13 months later.
- **In real income crashes, cash moves and fixed costs don't.** Across 569 crashes, cash withdrawals fell 59%;
  household bills, insurance and loan payments did not change.

These findings decide which guardrails exist and are shown in each guardrail's **Why this** explainer.

---

## Running it

Needs Python 3.11+ ([uv](https://docs.astral.sh/uv/) recommended), Node 20+, and the data files in
`data/data/`. `transactions.csv` (about 100 MB) is not in the repo: unzip it from the datathon download into
`data/data/`.

```bash
# backend
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env            # fill in at least GEMINI_API_KEY and GEMINI_MODEL
uvicorn src.api:app --reload --port 8000

# frontend (second terminal)
cd frontend && npm install && npm run dev      # http://localhost:5173
```

The Vite dev server proxies `/api` to port 8000. To use another backend port, start the frontend with
`API_PORT=8001 npm run dev`. Restart the backend after editing `.env`.

### Settings (`.env`)

| Variable | Needed for | Without it |
|---|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Reading twist cards, plans, the agent, the necessity check | Presets and keyword rules still work; no AI plan |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET_ID` | PayPal sandbox checkout in the stores (a REST app's keys from developer.paypal.com, sandbox) | The stores show card checkout only |
| `PAYPAL_VOLT_PAYEE` | Optional: a second sandbox business email so Volt's orders go to a different merchant | Both stores pay the app's own sandbox merchant |
| `NTFY_TOPIC` | Push alerts to a phone: install the ntfy app and subscribe to the same topic | Alerts only appear in Agent activity |

Never commit `.env`. It is git-ignored.

### Tests and checks
```bash
pytest -q                          # engine, details/summary, actions, AI (faked Gemini) and API
cd frontend && npx eslint src      # lint
python -m src.summary 20134        # print exactly what Gemini sees for an account
```

### Good accounts to try
- **20111:** cash-heavy, a loan in arrears, 7.8 months of runway today, 3.4 after a layoff on EI.
- **20134:** has household bills and a loan.

---

## Repo layout

```
data/                     the brief (README.md) and CSVs (transactions.csv is git-ignored)
src/
  engine.py               runway with the judges' formula; composable shocks
  features.py             per-account I, F, S, B, H, P table -> cache/features.parquet
  details.py              per-account details for the plan (categories, standing orders, loan, payees)
  summary.py              the plain-text fact sheet Gemini reads, with ref ids
  ai.py                   Gemini client: twist reading, plan prompt and response schema
  actions.py              checks and caps Gemini's actions, maps them to metric changes
  guidance.py             loads docs/insights and docs/guides into the prompt
  service.py              UI-agnostic layer returning JSON-safe dicts
  agent.py                the Guardian agent: tools, allowlist, rule checks, sandbox
  customer.py             the sandbox card: purchases, necessity check, messages
  paypal.py               PayPal sandbox orders: create, read back, capture
  notify.py               push alerts through ntfy
  api.py                  FastAPI routes
frontend/src/
  rail/                   the 3D guardrail scroll story (home page)
  drive/                  the engine dashboard and the Why-this explainer charts
  customer/               the demo stores, PayPal buttons, sandbox client
  findings/               the findings page
  runway.js               browser copy of the engine formula
findings/                 the analysis behind the findings (notebook, figures, README)
docs/insights/            population findings added to the AI prompt
tests/                    pytest suite
```

### API

| Route | What it does |
|---|---|
| `GET /api/accounts/{id}` | The customer's figures and runway (optionally with a shock) |
| `POST /api/ai/plan` | Read a twist card and return a checked, scored plan |
| `POST /api/ai/followup` | Ask about or revise the plan in conversation |
| `POST /api/agent/apply` | The Guardian agent applies or undoes one guardrail |
| `GET /api/history/{id}` | The last 12 months, for the explainer charts |
| `GET /api/customer/{id}` · `POST /api/customer/purchase` · `POST /api/customer/{id}/reset` | The sandbox card |
| `GET /api/paypal/config` · `POST /api/paypal/order` · `POST /api/paypal/approved` | PayPal sandbox checkout |

Interactive docs at http://localhost:8000/docs.

---

## Limits and honesty notes

- **Everything that acts is a simulation.** The guardrails change settings on an in-memory sandbox account,
  PayPal runs in its sandbox, and the stores are made up to illustrate the agent. Nothing touches a real
  bank account, and the sandbox resets when the backend restarts.
- **The stores are not real businesses.** Fresh Basket and Volt, their products and prices are invented for
  the demo, with no real brands.
- **No trained prediction model runs in the app.** The forecasting is the judges' own formula, so it can be
  checked. The data science is in the findings, which decide which guardrails matter; Gemini turns them into
  a plan per customer and code checks every number.
- **The data has limits.** There are no merchant names, so cash and unlabelled transfers cannot be broken
  down. About 27% of accounts have no labelled household bills, so a bill shock does not move them.

## Credits

- **Data:** PKDD'99 Discovery Challenge Financial dataset (real anonymized Czech bank data; dates shifted to
  2020–2025 and amounts in CAD for the datathon), CTU Prague Relational Dataset Repository:
  https://relational.fel.cvut.cz/dataset/Financial
- **AI:** Google Gemini via `google-genai`.
- **Payments sandbox:** PayPal Developer sandbox. **Push alerts:** ntfy.sh.
- **3D:** three.js.
