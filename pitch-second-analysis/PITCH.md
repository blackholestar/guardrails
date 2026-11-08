# Pitch outline: what makes people fail financially

Outline for the 1-minute pitch and the homepage. Each section below is one slide, or one section of the homepage, in this order. Chart images referenced are in `figures/` next to this file.

**Event:** Sheridan Datathon 2026, Tangerine track "Resilience Rewired". Judging: Discovery 35%, Data Use 25%, Communication 25%, Impact 15%. The pitch should show our biggest finding and hand over to the live engine.

**Data:** 4,500 real, anonymized bank customers, about 1.06 million transactions, and 682 loans with known outcomes, 2020–2025, in Canadian dollars.

**The message in one line:** people don't fail because they earn too little. They fail when their income is unsteady and their cushion is thin, and five everyday habits show it early.

---

## 1. Earning isn't the problem (0:00–0:08)

**Headline:**
> **73.5%** earn more than they spend
> **35%** can't survive 6 months on EI

**Say:** "Three in four customers earn more than they spend, yet one in three couldn't last six months on EI. Earning isn't the problem."

**Supporting numbers:** median customer lasts 8.6 months on EI at 55% of income; 9.7% last under 3 months.

## 2. Two factors predict failure (0:08–0:22)

**Visual:** `1b_default_2x2.png`, with the unsteady income + thin cushion corner highlighted.

| | Thin cushion | Real cushion |
| :-- | --: | --: |
| Steady income | 6.8% default | 1.8% default |
| Unsteady income | **26.2% default** | 10.2% default |

**Say:** "Against 682 real loans, two things predict default: unsteady income and a thin cushion. Both: 26% default. Neither: under 2%."

**Supporting numbers:** 76 of 682 loans defaulted (11.1%). The worst group defaults 14× more than the best. A real cushion halves the risk of unsteady income but doesn't remove it. Only behaviour from before each loan was used.

## 3. Five habits show it early, and they stack (0:22–0:36)

**Visual:** `10_pitfalls.png`, then the left panel of `11_stacking.png`.

| Persona | The habit | Share of customers | Risk of overdrawing later |
| :-- | :-- | --: | --: |
| The Slow Drainer | Savings fell more than 20% over time | 11% | **6.0×** |
| The Cash Spender | Over two-thirds of spending is untracked cash | 55% | **4.9×** |
| The Unprotected Freelancer | Uneven income and under 3 months of savings | 26% | **4.4×** |
| The Windfall Spender | Keeps under a quarter of a big month's extra money | 19% | **4.2×** |
| The Edge Walker | Spends as much as or more than they earn | 24% | **2.5×** |

| Number of habits | Overdraw later | Loan default |
| :-- | --: | --: |
| 0 ("The Steady Saver") | 0.1% | — |
| 1 | 3.0% | 6.0% |
| 2 | 3.5% | 7.0% |
| 3+ | **13.0%** | **17.1%** |

**Say:** "Five early habits predict overdraft later, led by a slowly draining balance at six times the risk. They stack: with none, almost nobody overdraws. With three or more, 13% do."

**Supporting numbers:** habits were measured in the first half of each customer's history and compared with overdrafts in the second half. Every habit also predicts real loan default. 32% of customers have none of them.

## 4. The standard measure misses it (0:36–0:44)

**Visual:** `8_default_maps.png`, pointing at the right edge of the right panel.

> The customers the standard "months of runway" calls safest defaulted at **17%**, above the 11% average.

**Say:** "The standard runway number misses this: the customers it calls safest defaulted above average."

**Supporting numbers:** 17 of 98 customers with "120+ months, no shortfall" defaulted. Runway predicts default barely better than a coin flip. Unsteady income and cushion together predict it well. (If the pitch runs long, cut this section and keep it for questions.)

## 5. Small habits fix most of it (0:44–0:50)

**Visual:** `13_habits.png`.

| Habit | Overdraft months it would have prevented |
| :-- | --: |
| Cut flexible spending 10% | 85% |
| Pay yourself first: save 5% of income | 79% |
| Save half of every windfall | 60% |

**Say:** "Small habits fix most of it: saving half of every windfall prevents 60% of overdraft months."

**Supporting numbers:** based on replaying 1,326 real overdraft months from 288 customers. Overdrafts are shallow (typically $1,626 for 13 days), so small savings cover them. The windfall habit costs about 0.12 months of spending a year.

## 6. Our engine (0:50–1:00)

**Visual:** the live engine (or `9_flow.png`).

| After a job loss on EI | Last 6+ months | Last under 3 months |
| :-- | --: | --: |
| No plan | 64.9% | 9.7% |
| With the plan | **83.6%** | **3.3%** |

The plan: cut flexible spending 20% and pause loan payments during the shock.

| Persona | What the engine suggests |
| :-- | :-- |
| The Slow Drainer | An alert when savings fall 10% below last quarter |
| The Cash Spender | A weekly cash budget |
| The Unprotected Freelancer | Save in good months until 3 months are put away |
| The Windfall Spender | Save half of every windfall |
| The Edge Walker | Pay yourself first: 5% of income on payday |
| The Steady Saver | Keep doing what you're doing |

**Say:** "Our engine finds each customer's habits, applies any shock, and builds their plan, lifting job-loss survival from 65 to 84 percent. Give us an account."

---

## Questions from judges

- **Do these habits cause failure?** We say "predict". They come before the failure: each habit was measured early in a customer's history and checked against what happened later, and against real loan default.
- **Why doesn't runway work?** It divides savings by the monthly shortfall. A high earner with good savings can get a short runway, and a low spender with little money a long one, so it mixes two signals that point in opposite directions.
- **Is cash spending really the problem?** It's a warning sign, not proof. Cash-heavy customers may also earn less or bank less. Tracking spending is still something an app can help with.
- **Are the habit results what people actually did?** No. They show what would have happened if the habit had been kept.
- **Why no loan default number for zero habits?** Only 18 loan customers had none, too few to read.
- **Do your numbers match the judges'?** Yes, we use the judges' definitions.

### Extra findings for questions

- **Timing:** a job loss starting in January leaves 53% lasting 6 months, against 65% for a February start. January spending is 1.45× a normal month, every year.
- **The real EI cap:** EI pays at most $729 a week in 2026. With the cap, 6-month survival falls from 65% to 49%.
- **Emergency fund:** 3 months of spending carries 90% of customers through 6 months on EI. One in five has no surplus to save from.
- **Loan customers** are the most fragile group. Pausing loan payments during a job loss lifts their survival from 36% to 68%.
- **Pension income** protects the most. Where someone lives barely matters.

### Limits

- The data is from one bank (1990s Czech data, re-dated and converted to Canadian dollars), and its customers mostly use cash.
- 76 loan defaults is a small sample.
- The exact percentages belong to this group of customers. The patterns are the part that carries over.

---

## Sources and credits

- PKDD'99 Discovery Challenge Financial dataset, CTU Prague Relational Dataset Repository: https://relational.fel.cvut.cz/dataset/Financial
- EI regular benefits (55% basic rate): https://www.canada.ca/en/services/benefits/ei/ei-regular-benefit.html
- EI benefit amount (2026 maximum $729/week): https://canada.ca/en/services/benefits/ei/ei-regular-benefit/benefit-amount.html
