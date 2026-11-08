// Browser copy of the runway formula in src/engine.py, used only by the landing page's live demos.
// The app page gets every number from the backend instead.

const CAP = 120

export const money = (x) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(x)

// c: { I, S, B, H }; s: optional shock with the same fields as engine.Shock.
export function runway(c, s = {}) {
  const income = (s.income_multiplier ?? 1) * c.I
  const spending = c.S + (s.bills_pct ?? 0) * (c.H ?? 0) + (s.extra_monthly ?? 0)
  const left = c.B - (s.one_off_cost ?? 0)
  const gap = spending - income
  let months
  let noShortfall = false
  if (left <= 0) months = 0
  else if (gap <= 0) {
    months = CAP
    noShortfall = true
  } else months = Math.min(left / gap, CAP)
  return { income, spending, left, gap, months, noShortfall, label: months.toFixed(1) }
}

// Share of accounts whose savings last under `within` months when they keep `kept` of their income.
// rows: [I, S, B] per account (src/data/accounts.json).
export function shareRunningOut(rows, kept, within = 6) {
  let out = 0
  for (const [I, S, B] of rows) {
    if (runway({ I, S, B, H: 0 }, { income_multiplier: kept }).months < within) out += 1
  }
  return rows.length ? out / rows.length : 0
}
