# Population findings for the AI plan

Every `.md` file in this folder (except this README) is added to the Gemini plan prompt as background, in file-name order. The combined text is cut at 6,000 characters, so keep it short. Changes apply on the next plan request.

What to write:
- Findings across all accounts, not about one customer: the most common reasons accounts run out of money, the strongest predictors, and which changes help most and by how much.
- Short bullets in plain English, with the number and what it is measured on (for example, "share of the 454 at-risk accounts").
- Say "associated with", not "causes". The data does not support causal claims.
- No account ids or personal details.

The AI is told that a customer's own data always overrides these findings.

`01_population_findings.md` is a starting point taken from `docs/DATA_INSIGHTS.md`. Replace it or add files such as `02_<topic>.md`.
