# Tangerine: Resilience Rewired

Sheridan Datathon 2026, Tangerine track. A financial resilience engine for real bank customers.
The challenge brief and data dictionary are in [`data/README.md`](data/README.md).

## What it does
1. **Know the customer.** For any `account_id`: income, bills and fixed costs, savings buffer, runway.
2. **Take a shock.** Job loss with EI, higher bills, a one-off repair, or a mix, with adjustable size and duration.
3. **Make a plan.** An emergency-fund goal plan and a backup plan, based on the customer's own numbers.

Judging: Discovery 35%, Data Use 25%, Communication 25%, Impact 15%.
Demo format: 1 min pitch, 3 min live twist on a judge-chosen account, 1 min questions.

## Design principles
- **The engine is deterministic code.** Gemini never calculates. For a typed scenario it picks the event's shock variables and an itemized plan (category, monthly amount, steps, evidence). Code checks each amount against the account's records, works out its exact change to I, F, S, H and P, and the engine computes gap and runway.
- **Use the judges' definitions exactly** for the headline numbers (I, F, S, B, H, P, runway). Anything extra is shown separately and labelled.
- **Fallbacks for the live demo:** preset shock buttons and cached narratives if the API or network fails.

## Stack
| Layer | Tool |
|---|---|
| Language | Python 3.11+ (local: 3.14) |
| Data | pandas, pyarrow (Parquet cache) |
| Engine | Plain Python module |
| Backend API | FastAPI + uvicorn |
| Frontend | React (Vite), plain JavaScript |
| AI | Gemini API via `google-genai` (Flash-tier model) |
| Analysis | Jupyter + pandas (scikit-learn only if modelling) |
| Tests | pytest |

## Repo layout
```
data/                    given data (CSVs + challenge brief)
src/
  features.py            builds per-account feature table (I, F, S, B, H, P, ...)
  details.py             per-account detail cache for the AI plan (12-month categories, standing orders,
                         loan terms, recurring payees/payers, cash habits) -> cache/details/
  summary.py             plain-text account summary sent to Gemini, with ref ids actions can cite
  actions.py             checks Gemini's plan actions, caps amounts, maps them to metric changes
  guidance.py            loads docs/insights/*.md and docs/guides/*.md into the prompt
  engine.py              compute(account_id, shock) -> results
  plan.py                emergency-fund goal + backup plan (not built)
  ai.py                  Gemini client, plan prompt and response schema
  service.py             UI-agnostic layer returning JSON-safe dicts
  api.py                 FastAPI routes (/api/accounts/{id}, /api/glossary, ...)
  glossary.py            plain-language tooltip text and warning messages (served by the API)
frontend/                React app (Vite)
  src/App.jsx            account lookup page, metric cards with tooltips
  src/api.js             fetch client for the backend
  vite.config.js         proxies /api to the backend on port 8000
notebooks/               exploration scripts (explore_vulnerability.py, explore_levers.py)
docs/DATA_INSIGHTS.md    what the data contains and what it says about vulnerability
docs/insights/           population findings added to the AI prompt (drop in .md files; see its README)
docs/guides/             sourced Canadian guidance added to the AI prompt (empty for now)
tests/                   engine, details/summary, actions, AI (faked Gemini) and API tests
cache/                   derived Parquet (git-ignored)
```

## How to run

Requires [uv](https://docs.astral.sh/uv/) (or any Python 3.11+ with venv) and the `data/data/*.csv` files.

```bash
# 1. One-time setup (from the project root)
uv venv                                  # creates .venv (answer y if it asks to replace)
source .venv/bin/activate
uv pip install -r requirements.txt

# 2. Gemini key (needed for "What if…?" plans)
cp .env.example .env                     # then set GEMINI_API_KEY and GEMINI_MODEL

# 3. Build the caches (a few seconds each; both also auto-build on first use)
python -m src.features                   # writes cache/features.parquet
python -m src.details                    # writes cache/details/*.parquet; rebuild after changing src/details.py
python -m src.summary 20134              # prints exactly what Gemini sees for an account

# 4. Install frontend dependencies (one time; needs Node 20+)
cd frontend && npm install && cd ..

# 5. Run the app: two terminals, both from the project root
uvicorn src.api:app --reload --port 8000     # terminal 1: backend (API docs at http://localhost:8000/docs)
cd frontend && npm run dev                   # terminal 2: frontend at http://localhost:5173

# 6. Run tests
pytest -q

# 7. Re-run the data exploration (about 1 minute; reads the 100 MB transactions file)
python notebooks/explore_vulnerability.py
python notebooks/explore_levers.py

# 8. Live AI plan check (calls real Gemini; 18 requests). Saves to cache/eval/<prompt version>/
python -m notebooks.eval_plans
```

Without activating the venv, prefix Python commands with `.venv/bin/`, e.g. `.venv/bin/uvicorn src.api:app --port 8000`.
The frontend calls `/api/...`, which Vite proxies to port 8000, so the backend must be running.
Try account IDs 20134 (has bills and a loan), 20111 (no labelled bills) or 20133.

Current status: the account lookup page works (I, F, S, B, H, P, gap, runway, with hover tooltips). "What if…?" takes a typed scenario and returns an itemized plan from Gemini grounded in the account's own records (`POST /api/ai/plan`). Each step shows its checked monthly amount and exact change to each metric; the page shows runway before, after the event, and with the plan. Under the plan, the customer can keep talking to the AI (`POST /api/ai/followup`): questions get a reply only; requested changes get a complete revised plan, checked and scored like the first, shown with its own 8 metric cards and a runway comparison with the previous plan. The server is stateless: the browser sends the conversation back each turn, and the server re-checks the plan in effect. Not built yet: the goal/backup plan in `plan.py`, and a fallback when Gemini is unavailable.

## Plan

### Phase 1: afternoon (data + engine)
- [ ] `features.py`: per-account I, F, S, B, H, P, history length, loan status, district, age. Cache to Parquet.
- [ ] `engine.py`: runway per the README formula; composable shocks (income multiplier + duration, bills %, one-off cost).
- [ ] `tests/`: hand-check 3 to 5 accounts; edge cases (buffer <= 0, gap <= 0, cap at 120, zero bills).
- [x] React frontend + FastAPI backend wired to the engine (replaced the original Streamlit idea).

### Phase 2: evening (UI, plan, finding)
- [ ] Profile screen: income, fixed costs, buffer, runway, balance-history chart, spending breakdown.
- [ ] Shock panel: presets + sliders, before/after comparison.
- [ ] `plan.py`: emergency-fund target (3 and 6 months of S), monthly savings from surplus, ranked backup cuts with runway gained.
- [ ] Guardrails: short history, zero income, blank bills.
- [ ] Headline finding exploration (see options below).

### Phase 3: morning (AI, polish, submission)
- [ ] `ai.py`: narrative from engine JSON; twist parser with a JSON schema; fallbacks.
- [ ] Rehearse 3 to 4 mock twist cards on random accounts.
- [ ] Demo video (2 to 3 min), write-up, sources, repo cleanup.

### Stretch (only if time)
- [x] `standing_orders.csv` for committed vs flexible costs.
- [x] Transaction-based income regularity and recurring-payment detection.

## Headline finding options (decide after exploration)
- **Portfolio stress test:** share of 4,500 accounts that survive a 6-month EI spell, by region/age.
- **Default vs buffer:** do defaulted loans (about 76 of 682) show smaller buffers or runway?

## Data observations so far
- 4,500 accounts; median 36 months of history (range 12 to 72).
- 26% of accounts spend more than they earn before any shock.
- With EI at 55% for a job loss, about 10% have under 3 months of runway; 7.7% hit the 120-month cap.
- 27% of accounts have median `household_bills` = 0, so a "bills +15%" shock does nothing for them unless handled.
- Loan defaults: 11% (statuses B and D).

## Open decisions
- Team size and task split.
- Headline finding (portfolio stress test vs default vs buffer).
- AI scope: narrative only, or narrative + twist parser.

## Sources and credits
- PKDD'99 Discovery Challenge Financial dataset, CTU Prague Relational Dataset Repository: https://relational.fel.cvut.cz/dataset/Financial
- Statistics Canada and Government of Canada sources, if used (list them here).
