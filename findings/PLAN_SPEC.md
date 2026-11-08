# Using the findings in the plan (spec)

Goal: the plan for each customer should change when their numbers match a pattern that predicted trouble in
our data. The engine still does all the math; the findings decide **which warnings appear, how big the
safety net should be, and which moves come first**. Gemini receives the signals and the evidence and writes
the plan in plain language.

Evidence for every number below: [`README.md`](README.md) and [`findings_walkthrough.ipynb`](findings_walkthrough.ipynb).

## 1. Signals to compute per account (add to `src/features.py`)
All use the account's monthly rows sorted by `month`; "last 12" = the last 12 rows.

| Signal | Definition | Flag |
|---|---|---|
| `worst_day_12m` | `min(min_balance)` over the last 12 rows | `near_miss` if `< 500` |
| `income_volatility` | `std(money_in) / mean(money_in)` over the last 12 rows (pandas default std, ddof=1); 0 if mean is 0 | `unsteady_income` if `>= 0.5` |
| `savings_months` | `B / S` (README buffer over typical spending) | `thin_savings` if `< 1` |
| `runway_laid_off` | README runway with `income_multiplier = 0.55` | `fragile` if `< 3` |
| `borrower` | account has any loan (status A, B, C or D) | `borrower` |
| `running_loan` | `P > 0` (README: status C or D) | used for the loan-deferral move |

## 2. What each flag changes in the plan
| Flag | Evidence (our data) | Change to the plan |
|---|---|---|
| `near_miss` | Lowest balance is the best predictor of a future overdraft (AUC 0.90; 0.81 for people never overdrawn). Worst day below $500 before a loan: 21.6% default vs 0.8% above $5k. A near-miss came a median 13 months before the first overdraft. | Warn first. Recommend a low-balance alert at $1,000 and a buffer floor (keep at least one month of fixed costs untouched). |
| `unsteady_income` | 4.7x the odds of default, controlling for income, savings and loan size. | Emergency-fund target 6 months of spending instead of 3; save a share of high-income months rather than a fixed amount. |
| `thin_savings` / `fragile` | In 569 real income crashes: 25% overdrawn with < 1 month of savings, 0% with 6+. 2024 runway-if-laid-off < 3 months: 17.7% overdrawn in 2025 vs 1.1% at 12+. | Building the buffer is step 1, before any other goal. |
| `borrower`, `running_loan` | Borrowers have about half the odds of surviving a 6-month EI shock at the same income. | If runway falls short, the first move to test is deferring or reducing the loan payment `P`. |
| (all customers) | In real crashes, cash spending fell 59% while bills, insurance and loan payments did not move. | Cuts come from flexible spending (cash and card), never from fixed costs (bills, insurance, loan). |
| (not a signal) | Income level did not predict default (OR 0.76, not significant) or overdraft (AUC 0.45). | Do not tell high earners they are safe because of their income. |

## 3. Hard requirements for the plan
1. **The plan must get runway to at least the shock's length** (e.g. 6 months for EI). Check with the engine
   (`compute(...)` on the plan's variables); if Gemini's plan falls short, ask again with the gap stated, or fall
   back to the engine's ranked moves. If no plan can reach it, say so plainly.
2. **Never cut fixed costs** (household bills, insurance, loan payments) except through an explicit loan deferral.
3. **Cite the customer's own numbers**, and the flag that drove each step.
4. **Phrase evidence as patterns, not predictions about this person**: "customers with unsteady income fell behind
   about 5x as often in our data", not "you have a 27% chance of default".

## 4. Prompt addition for `src/ai.py` (`_system_prompt`)
Append the customer's signals and only the evidence lines for flags that are on, e.g.:

```
Risk signals for this customer (from our analysis of 4,500 accounts):
- near_miss: lowest balance in the last 12 months was $-581. In our data this was the strongest warning sign of a
  future overdraft, usually appearing about a year before it. Recommend a low-balance alert and a buffer floor.
- unsteady_income: month-to-month income varies by 99% of its average. Customers like this defaulted about 5x as
  often; size the emergency fund at 6 months of spending, not 3.
- running_loan: loan payment P = $2,330. If runway is short, test deferring P first.
Rules: cuts come from flexible spending (cash and card), never bills, insurance or loan payments.
The plan must reach runway >= income_months; if it cannot, say so.
```

## 5. Caveats to keep in the product copy
- Associations in one dataset (PKDD'99 bank data, converted to CAD with shifted dates), not proven causes.
- 65 loan defaults: odds ratios are directional, intervals are wide (e.g. 2.5x to 8.8x).
- The README runway assumes spending stays the same after a shock; in real crashes people cut about 60%, so the
  README number is a worst case.
