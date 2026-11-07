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
- **The engine is deterministic code.** Gemini never calculates; it only explains results and (optionally) parses a typed twist card into shock parameters.
- **Use the judges' definitions exactly** for the headline numbers (I, F, S, B, H, P, runway). Anything extra is shown separately and labelled.
- **Fallbacks for the live demo:** preset shock buttons and cached narratives if the API or network fails.

## Stack
| Layer | Tool |
|---|---|
| Language | Python 3.11+ (local: 3.14) |
| Data | pandas, pyarrow (Parquet cache) |
| Engine | Plain Python module |
| UI / charts | Streamlit, Plotly |
| AI | Gemini API via `google-genai` (Flash-tier model) |
| Analysis | Jupyter + pandas (scikit-learn only if modelling) |
| Tests | pytest |

## Repo layout
```
data/                    given data (CSVs + challenge brief)
src/
  features.py            builds per-account feature table (I, F, S, B, H, P, ...)
  engine.py              compute(account_id, shock) -> results
  plan.py                emergency-fund goal + backup plan
  ai.py                  Gemini narrative + twist-card parser
app.py                   Streamlit UI
notebooks/finding.ipynb  exploration for the headline finding
tests/test_engine.py     checks against the README formulas
cache/                   derived Parquet (git-ignored)
```

## Setup
```
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env     # add GEMINI_API_KEY
python -m src.features   # builds cache/features.parquet
streamlit run app.py
pytest
```
Environment check on this machine: pandas, pyarrow, streamlit, plotly are installed. Still missing: pytest, google-genai, python-dotenv, scikit-learn (all in `requirements.txt`).

## Plan

### Phase 1: afternoon (data + engine)
- [ ] `features.py`: per-account I, F, S, B, H, P, history length, loan status, district, age. Cache to Parquet.
- [ ] `engine.py`: runway per the README formula; composable shocks (income multiplier + duration, bills %, one-off cost).
- [ ] `tests/`: hand-check 3 to 5 accounts; edge cases (buffer <= 0, gap <= 0, cap at 120, zero bills).
- [ ] Streamlit skeleton wired to the engine.

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
- [ ] `standing_orders.csv` for committed vs flexible costs.
- [ ] Transaction-based income regularity and recurring-payment detection.

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
