# Data insights: who is vulnerable, why, and what helps

Produced by `notebooks/explore_vulnerability.py` and `notebooks/explore_levers.py`.
All figures are from the 4,500 accounts. "At risk" means under 3 months of runway after a job loss with EI at 55% (judges' formula). 10.1% of accounts (454) are at risk.

## 1. What information exists

| Source | Usable attributes | Notes |
|---|---|---|
| `clients` + `dispositions` | Owner age (16 to 81, median 44), gender (50/50), owner vs authorized user, number of people on the account | 869 accounts (19%) have a second person (authorized user). Client home district differs from the account's branch district for 9%. |
| `accounts` | Statement frequency (monthly 93%, weekly 5%, after each transaction 2%), account opening date | Statement frequency is a possible preference/engagement signal. |
| `cards` | Card type (classic, gold, junior), issue date | Only 892 cards; 20% of accounts have one. |
| `districts` | Region, population, urban ratio, average salary, unemployment 2022/2023, entrepreneurs per 1000, crimes | Branch-level context only. |
| `loans` | Amount, duration, payment, status A/B/C/D, default flag | 682 loans (15% of accounts). The only real outcome label. |
| `standing_orders` | Count and size of committed recurring payments, by purpose (household bills 3,502, other 1,379, loan 717, insurance 532, leasing 341) | 742 accounts have none. |
| `monthly_summary` | Income by source (cash deposits, transfers in, pension, interest), spending by category, balances, days below zero | Supports volatility, savings rate, deficit frequency, cash reliance, balance trend. |
| `transactions` | Dates, payees (`partner_account`), operation types | Supports regular-payer detection (1,606 accounts have 12+ transfers from the same payer), payee counts (median 1 payee), debit timing, largest single debit relative to monthly spending, seasonality. 53% of debits have no purpose label. |

Not present: occupation, household size, dependents, housing tenure, education, true income source, savings products. "Role" is limited to owner vs authorized user, and "life situation" has to be inferred (pension recipients, regular salary payers, loan holders).

## 2. Who is most affected

Group differences (share of accounts at risk under EI55, unless stated):

| Group | At risk | Other signals |
|---|---|---|
| Has a loan | 21.6% (vs 8.0% without) | Median buffer is 2.0 months of spending vs 3.9. |
| Loan defaulted (B) / in debt (D) | 58% / 42% | Median buffer about 1.1 to 1.5 months. |
| Savings rate in lowest quartile (under about 5%) | 30.0% | 50% spend more than they earn; 18% have had a negative balance. |
| Savings rate in top quartile | 0.2% | |
| Weekly statements | 23.8% | Deficit in 48%. |
| Statement after each transaction | 24.7% | 24% have been overdrawn. |
| Cash deposit share of income at 99.2% or more | 26.0% | Median runway 4.2 months vs 28.7 for those with no cash deposits. |
| Highest income-volatility quartile | 16.7% | Overdrawn 17%; loan default 20%. |
| Cash withdrawals above 66% of spending | 14% to 16% | vs 2.8% when cash is under 49%. |
| Income quartile 4 (above about $13k) | 20.7% | Runway is shorter in months because spending scales with income while buffers do not. |
| Age 65+ | 0% | Pension recipients; only 0.5% in deficit. |
| Age 25 to 54 | 12% to 13% | Deficits in 28% to 31%. |
| Under 25 | 8.7% | Deficit in 37%, and loan default is highest (14%). |
| Joint accounts (2 people) | 8.9% | None has ever been overdrawn, and none has a defaulted loan. |

Weak or absent effects: gender (9.1% F vs 11.0% M), region (7% to 12%), district unemployment (flat across quartiles), district urbanization, district crime, and account history length.

## 3. Habits and situations linked to vulnerability

Spearman correlation with EI55 runway (positive = more resilient):
- Savings rate +0.76, balance trend +0.48, pension share +0.40, bills share +0.23, age +0.21, standing orders relative to income +0.19.
- Share of months in deficit -0.62, cash-deposit share of income -0.52, cash-withdrawal share of spending -0.36, income volatility -0.22, bank fees -0.28.

Loan default (682 loans), Spearman correlation: savings rate -0.28, income volatility +0.26, buffer -0.24, payment-to-income +0.23, loan amount vs buffer +0.20. Default rate by payment-to-income quartile: 4%, 9%, 8%, 23%.

Seasonality: income jumps in June and December (about $13.2k to $13.4k vs about $10.5k in other months), and spending spikes in January and June. Both are usable for timing a shock.

## 4. What helps (levers)

From `explore_levers.py` (454 at-risk accounts):
- At-risk accounts spend a median 74% of their outflows on cash withdrawals, and spend about 1.05x their income.
- Cutting cash withdrawals by 10% moves 158 of 454 (35%) above 3 months. A 20% cut moves 263 (58%). A 30% cut moves 339 (75%). Median runway gains are 0.4, 0.9 and 1.7 months.
- 56% of accounts already hold at least 3 months of spending. 19% are below that target and have no surplus, so a savings plan alone can't help them without a spending change.
- Of the below-target accounts with a surplus, the median time to reach the 3-month target at the current surplus is 11.7 months, but 25% would need more than 33 months.

## 5. Cautions

- Runway in months correlates -0.79 with spending S and -0.68 with income I. Higher-income households look more fragile mostly because the formula divides by spending. Present both runway and buffer-in-months-of-spending, or control for income when comparing groups.
- Several splits are suspiciously clean: loans in status A or C have never been overdrawn, B and D have always been; joint accounts have no overdraft and no default; accounts with exactly 2 standing orders have none either. The data looks partly synthetic or rule-generated. Report these as observed patterns, and avoid causal claims.
- `card_withdrawals` is almost always 0, so cash withdrawals are the only flexible spending category.
- 27% of accounts have no labelled household bills in `monthly_summary`; 1,063 of the 1,225 such accounts also have no bills standing order, so the missing bills are real gaps in the data, not a labelling problem.
- Small samples: default counts are about 76 loans, and many subgroup differences have only a few hundred accounts.
- No causal identification. The data supports "associated with", not "causes".

## 6. Candidate analyses for the headline finding

1. **Fragility is a savings-rate problem, not a demographics problem.** Savings rate, deficit frequency and cash reliance explain far more than age, gender, region or district conditions (which are flat).
2. **Cash-dependent, low-margin households.** A segment with high cash deposits and withdrawals, volatile income and near-zero savings: 26% at risk, 4.2 months median runway. Cutting cash withdrawals 20% would rescue over half of the at-risk group.
3. **Loan holders.** 2.7x more likely to be at risk, and the payment-to-income ratio predicts default (23% in the top quartile). A simple pre-loan warning score is feasible.
4. **Retirees are buffered by pension income.** 0% at risk, which is a useful contrast for the pitch.
