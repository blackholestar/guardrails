// Findings from the team's analysis (tangerine-resilience-engine/analysis). Figures are real, not placeholders.
// Source: 4,500 accounts; 615 loans with >= 6 months of history before the loan.

export const shocks = [
  { label: 'No shock', share: 0.027 },
  { label: 'Laid off, EI 55%', share: 0.355 },
  { label: 'Furnace dies', share: 0.088 },
  { label: 'Laid off + bills +15%', share: 0.389 },
]

// Working customers with regular income (lowest quartile excluded: 29% of it holds >12 months of savings,
// which looks like side accounts rather than real low earners).
export const incomeSurvival = [
  { label: '2nd quarter', income: 7096, survives: 0.62, savingsMonths: 3.3 },
  { label: '3rd quarter', income: 11992, survives: 0.49, savingsMonths: 2.5 },
  { label: 'Top quarter', income: 19705, survives: 0.30, savingsMonths: 1.8 },
]

export const steadiness = {
  lower: { steady: 0.055, unsteady: 0.271 },
  higher: { steady: 0.025, unsteady: 0.140 },
}

export const worstDay = [
  { label: 'Below $500', rate: 0.216, n: 204 },
  { label: '$500–2k', rate: 0.108, n: 111 },
  { label: '$2k–5k', rate: 0.167, n: 42 },
  { label: 'Above $5k', rate: 0.008, n: 258 },
]

export const loanSurvival = [
  { label: 'No loan', share: 0.70 },
  { label: 'Repaid', share: 0.32 },
  { label: 'Running, OK', share: 0.39 },
  { label: 'Running, in debt', share: 0.16 },
  { label: 'Defaulted', share: 0.13 },
]

export const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const seasonOut = [11518, 4392, 5682, 5899, 6223, 9856, 5661, 5934, 6015, 6302, 6184, 7363]
export const seasonIn = [7488, 7432, 7294, 7091, 6939, 10013, 7366, 7118, 7031, 6990, 6911, 9724]
