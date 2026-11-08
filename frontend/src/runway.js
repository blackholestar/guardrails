// Client-side mirror of the README runway formula, used for previews (landing slider, lever ranking).
// The backend engine (src/engine.py) stays the source of truth for the headline numbers.
export const CAP = 120

// returns months (number) or Infinity-like CAP; label separately
export function runway({ I, S, B, H = 0 }, s = {}) {
  const income = I * (s.income_multiplier ?? 1)
  const spending = S + (s.bills_pct ?? 0) * H + (s.extra_monthly ?? 0)
  const left = B - (s.one_off_cost ?? 0)
  const gap = spending - income
  if (left <= 0) return { months: 0, label: '0.0', gap, income, spending, left, noShortfall: false }
  if (gap <= 0) return { months: CAP, label: 'No shortfall', gap, income, spending, left, noShortfall: true }
  const m = Math.min(left / gap, CAP)
  return { months: m, label: (Math.round(m * 10) / 10).toFixed(1), gap, income, spending, left, noShortfall: false }
}

// Share of accounts whose savings last under `months` when income is multiplied by k
export function shareRunningOut(rows, k, months = 6) {
  let out = 0
  for (const [I, S, B] of rows) {
    if (runway({ I, S, B }, { income_multiplier: k }).months < months) out += 1
  }
  return out / rows.length
}

// Levers: moves that extend runway, applied on top of a shock. Each is ranked by months gained.
export function levers(p, shock) {
  const base = runway(p, shock)
  const flexible = Math.max(p.S - p.F, 0)
  const opts = [
    p.P > 0 && { id: 'pause-loan', label: 'Pause the loan payment', detail: `${money(p.P)} a month deferred`, s: { extra_monthly: (shock.extra_monthly ?? 0) - p.P } },
    flexible > 0 && { id: 'cut-20', label: 'Cut flexible spending 20%', detail: `${money(0.2 * flexible)} a month less cash and card spending`, s: { extra_monthly: (shock.extra_monthly ?? 0) - 0.2 * flexible } },
    { id: 'side-500', label: 'Add $500 a month of income', detail: 'Part-time work or a partner’s help', s: { income_multiplier: (shock.income_multiplier ?? 1) + 500 / Math.max(p.I, 1) } },
  ].filter(Boolean)
  return opts
    .map((o) => {
      const r = runway(p, { ...shock, ...o.s })
      return { ...o, after: r, gained: r.months - base.months }
    })
    .sort((a, b) => b.gained - a.gained)
}

export const money = (x) =>
  x === null || x === undefined || Number.isNaN(x)
    ? '—'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(x)
