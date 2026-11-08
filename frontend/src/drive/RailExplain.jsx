import { useEffect, useState } from 'react'
import { money } from '../runway'

// The "why" behind one guardrail, as charts: this customer's own months, the population finding that
// picked this lever, and the runway before and after. Every number is from the data or findings/README.md.

const SERIES = {
  cash_limit: { col: 'cash_withdrawals_genuine', name: 'Cash withdrawals' },
  card_cap: { col: 'card_withdrawals', name: 'Card spending' },
  transfer_hold: { col: 'transfers_out_other', name: 'Other transfers out' },
  standing_order: { col: 'transfers_out_other', name: 'Other transfers out' },
  loan_deferral: { col: 'loan_payments', name: 'Loan payments' },
  balance_alert: { col: 'min_balance', name: 'Lowest balance in the month' },
  customer_step: { col: 'money_out', name: 'Money out' },
}

const TEXT = {
  cash_limit: {
    title: 'Cash is the lever people really pull',
    body: 'In 569 real income crashes, three months later cash withdrawals had fallen 59%, while household bills, insurance, loan payments and other transfers did not move at all. So the plan cuts where this customer can actually cut.',
  },
  loan_deferral: {
    title: 'Two warning signs predict default; income does not',
    body: 'Across 615 loans (65 defaults), unsteady income and a balance dip below $500 each raise the odds of default about five times, controlling for income, savings and loan size. Income level itself is not significant. Talking to the lender before a missed payment targets exactly that risk.',
  },
  balance_alert: {
    title: 'A near-miss gives about a year’s warning',
    body: 'Of the 288 accounts ever overdrawn, 64% first had a near-miss: a balance between $0 and $500. The first overdraft came a median 13 months later. An alert at that point catches the slide while there is still time.',
  },
  runway: {
    title: 'More months of runway, far fewer overdrafts',
    body: 'We computed each customer’s runway if laid off from 2024 data, then checked who was really overdrawn in 2025 (3,657 accounts). Under 3 months: 17.7% overdrawn. 12 months or more: 1.1%. Every month this guardrail adds moves the customer toward the safer bands.',
  },
}


// One plain sentence under each chart, so the reason reads at a glance.
function takeaways(kind, rail, hist, col, before, after) {
  const vals = (hist || []).map((h) => Number(h[col]) || 0)
  const sorted = [...vals].filter((v) => v > 0).sort((a, b) => a - b)
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const low = vals.length ? Math.min(...vals) : 0
  const gain = Math.max(after - before, 0).toFixed(1)
  const mine = {
    cash_limit: `They take out about ${money(med)} in cash a month. A limit of ${money(Math.max(med - (rail.amount || 0), 0))} saves ${money(rail.amount || 0)} where they have room to cut.`,
    card_cap: `They spend about ${money(med)} a month on the card. The cap trims ${money(rail.amount || 0)} of it.`,
    transfer_hold: `About ${money(med)} a month goes out in other transfers. Holding the large ones saves ${money(rail.save || 0)}.`,
    standing_order: `About ${money(med)} a month goes out in other transfers. Pausing this one saves ${money(rail.save || 0)}.`,
    loan_deferral: `They pay about ${money(med || rail.amount || 0)} on the loan every month, whatever happens to income. Pausing it frees all of that while income is down.`,
    balance_alert: `Their balance fell as low as ${money(low)} in the past year. Under $500 is where trouble starts, so the alert fires there.`,
  }[kind] || `Money out runs about ${money(med)} a month. This step trims ${money(rail.save || 0)} of it.`
  const all = {
    cash_limit: 'When income crashes, people cut cash, not bills. So cash is the realistic place to save.',
    card_cap: 'When income crashes, people cut everyday spending, not bills. So this is a realistic place to save.',
    transfer_hold: 'When income crashes, bills and loans don’t move, so flexible spending is where the savings are.',
    standing_order: 'When income crashes, bills and loans don’t move, so flexible spending is where the savings are.',
    loan_deferral: 'Unsteady income and a low balance each make default about 5× likelier. A shock brings both, so ask the lender before a payment is missed.',
    balance_alert: 'Most overdrafts follow a near-miss by about a year. Catching the dip early leaves time to act.',
  }[kind] || 'Under 3 months of runway, about 1 in 6 got overdrawn. With 12 or more, about 1 in 100. Every month helps.'
  const buys = `On its own this adds ${gain} months: savings last ${after.toFixed(1)} months instead of ${before.toFixed(1)}.`
  return [mine, all, buys]
}

export function RailExplain({ accountId, rail, before, after, onBack }) {
  const [hist, setHist] = useState(null)
  useEffect(() => {
    let live = true
    fetch(`/api/history/${accountId}?months=12`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setHist(d?.months || []))
      .catch(() => live && setHist([]))
    return () => {
      live = false
    }
  }, [accountId])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const series = SERIES[rail.kind] || SERIES.customer_step
  const textKey = TEXT[rail.kind] ? rail.kind : 'runway'
  const t = TEXT[textKey]
  const why = takeaways(rail.kind, rail, hist, series.col, before, after)

  return (
    <div className="dx">
      <div className="dx-head">
        <button type="button" className="dx-back" onClick={onBack}>← Back to the plan</button>
        <p className="dx-kicker">Why this guardrail</p>
        <h2 className="dx-title">{rail.label}</h2>
        <p className="dx-gain">
          Runway <strong>{before.toFixed(1)}</strong> → <strong>{after.toFixed(1)} months</strong>
          <span>+{(after - before).toFixed(1)} from this guardrail alone</span>
        </p>
      </div>

      <div className="dx-grid">
        <figure className="dx-fig dx-fig-wide">
          <figcaption>
            <span className="dx-fig-n">1</span> This customer: {series.name.toLowerCase()}, last 12 months
          </figcaption>
          {hist === null ? (
            <div className="dx-wait" />
          ) : hist.length ? (
            <MonthBars rows={hist} col={series.col} kind={rail.kind} amount={rail.amount} />
          ) : (
            <p className="dx-none">No monthly history for this account.</p>
          )}
          <p className="dx-why">{why[0]}</p>
        </figure>

        <figure className="dx-fig">
          <figcaption>
            <span className="dx-fig-n">2</span> Across all customers: {t.title.toLowerCase()}
          </figcaption>
          {textKey === 'cash_limit' && <CrashBars />}
          {textKey === 'loan_deferral' && <OddsRatios />}
          {textKey === 'balance_alert' && <NearMiss />}
          {textKey === 'runway' && <RunwayBands before={before} after={after} />}
          <p className="dx-why">{why[1]}</p>
        </figure>

        <figure className="dx-fig">
          <figcaption>
            <span className="dx-fig-n">3</span> What it buys this customer
          </figcaption>
          <BeforeAfter before={before} after={after} />
          <p className="dx-why">{why[2]}</p>
        </figure>
      </div>

      <div className="dx-text">
        <div>
          <h3>{t.title}</h3>
          <p>{t.body}</p>
        </div>
        <div>
          <h3>This customer</h3>
          <p>{rail.evidence || `${series.name} over the last 12 months, shown in chart 1.`}</p>
          {rail.how && (
            <>
              <h3>How it works</h3>
              <p>{rail.how}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- charts (plain SVG) ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function MonthBars({ rows, col, kind, amount }) {
  const W = 1200
  const H = 260
  const pad = { l: 64, r: 12, t: 22, b: 28 }
  const vals = rows.map((r) => Math.max(r[col] || 0, 0))
  const med = median(vals)
  const isAlert = kind === 'balance_alert'
  const target = isAlert ? 500 : kind === 'loan_deferral' ? 0 : Math.max(med - (amount || 0), 0)
  const top = Math.max(...vals, target, 1) * 1.1
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top)
  const bw = (W - pad.l - pad.r) / rows.length
  const ticks = [0, top / 2, top].map((v) => Math.round(v / 100) * 100)
  return (
    <svg className="dx-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly amounts, last 12 months">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="dx-grid-line" />
          <text x={pad.l - 8} y={y(v) + 4} className="dx-axis" textAnchor="end">{money(v)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const v = vals[i]
        const x = pad.l + i * bw + bw * 0.18
        const over = !isAlert && kind !== 'loan_deferral' && v > target
        const low = isAlert && v < 500
        return (
          <g key={r.month}>
            <rect x={x} y={y(v)} width={bw * 0.64} height={Math.max(y(0) - y(v), 1)} className={`dx-bar${over || low ? ' is-hot' : ''}`}>
              <title>{`${r.month}: ${money(v)}`}</title>
            </rect>
            <text x={x + bw * 0.32} y={H - 8} className="dx-axis" textAnchor="middle">{MONTHS[Number(r.month.slice(5)) - 1]} {r.month.slice(2, 4)}</text>
          </g>
        )
      })}
      {kind !== 'loan_deferral' && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} className="dx-target" />
          <text x={W - pad.r} y={y(target) - 6} className="dx-target-label" textAnchor="end">
            {isAlert ? 'Alert below $500' : `New limit: ${money(target)} a month`}
          </text>
        </g>
      )}
      {kind === 'loan_deferral' && (
        <text x={W - pad.r} y={pad.t + 10} className="dx-target-label" textAnchor="end">A deferral pauses this payment</text>
      )}
    </svg>
  )
}

function HBars({ rows, max, fmt, highlight }) {
  const W = 720
  const rowH = 34
  const H = rows.length * rowH + 8
  const l = 190
  const zero = rows.some((r) => r.v < 0) ? l + (W - l - 50) * 0.75 : l
  const scale = (v) => (Math.abs(v) / max) * (rows.some((r) => r.v < 0) ? (zero - l) : W - l - 56)
  return (
    <svg className="dx-svg" viewBox={`0 0 ${W} ${H}`} role="img">
      <line x1={zero} x2={zero} y1={0} y2={H} className="dx-zero" />
      {rows.map((r, i) => {
        const yy = i * rowH + 8
        const w = Math.max(scale(r.v), 2)
        const x = r.v < 0 ? zero - w : zero
        return (
          <g key={r.k}>
            <text x={0} y={yy + 15} className="dx-label">{r.k}</text>
            <rect x={x} y={yy + 2} width={w} height={18} className={`dx-bar${highlight?.(r, i) ? ' is-hot' : ''}`} />
            <text x={r.v < 0 ? zero + 8 : x + w + 6} y={yy + 15} className="dx-val">{fmt(r.v)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function CrashBars() {
  const rows = [
    { k: 'Cash withdrawals', v: -59 },
    { k: 'Household bills', v: 0 },
    { k: 'Insurance', v: 0 },
    { k: 'Loan payments', v: 0 },
    { k: 'Other transfers', v: 0 },
  ]
  return (
    <>
      <HBars rows={rows} max={60} fmt={(v) => (v ? `${v}%` : '0%')} highlight={(r) => r.v < 0} />
      <p className="dx-note">Change 3 months after a real income crash, vs the prior 12-month median. 569 crashes.</p>
    </>
  )
}

function OddsRatios() {
  const rows = [
    { k: 'Unsteady income', or: 4.7, lo: 2.5, hi: 8.8 },
    { k: 'Balance dipped below $500', or: 4.9, lo: 2.7, hi: 8.8 },
    { k: 'Loan size', or: 2.3, lo: 1.5, hi: 3.4 },
    { k: 'Income level', or: 0.76, lo: 0.53, hi: 1.09 },
  ]
  const W = 720
  const l = 210
  const rowH = 36
  const H = rows.length * rowH + 30
  const lx = (v) => l + ((Math.log(v) - Math.log(0.4)) / (Math.log(10) - Math.log(0.4))) * (W - l - 16)
  return (
    <>
      <svg className="dx-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Odds of loan default">
        <line x1={lx(1)} x2={lx(1)} y1={0} y2={H - 22} className="dx-zero" />
        {[0.5, 1, 2, 5, 10].map((v) => (
          <text key={v} x={lx(v)} y={H - 6} className="dx-axis" textAnchor="middle">{v}×</text>
        ))}
        {rows.map((r, i) => {
          const yy = i * rowH + 16
          const hot = r.lo > 1 && r.k !== 'Loan size'
          return (
            <g key={r.k}>
              <text x={0} y={yy + 4} className="dx-label">{r.k}</text>
              <line x1={lx(r.lo)} x2={lx(r.hi)} y1={yy} y2={yy} className={`dx-ci${hot ? ' is-hot' : ''}`} />
              <circle cx={lx(r.or)} cy={yy} r={6} className={`dx-dot${hot ? ' is-hot' : ''}`} />
              <text x={lx(r.hi) + 8} y={yy + 4} className="dx-val">{r.or}×</text>
            </g>
          )
        })}
      </svg>
      <p className="dx-note">Odds of default with 95% intervals, log scale. 615 loans, 65 defaults. Right of 1× means riskier.</p>
    </>
  )
}

function NearMiss() {
  const W = 720
  const H = 150
  const l = 20
  const r = 700
  const x = (m) => l + (m / 24) * (r - l)
  return (
    <>
      <svg className="dx-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Months from near-miss to first overdraft">
        <text x={l} y={18} className="dx-label">Near-miss</text>
        <text x={r} y={18} className="dx-label" textAnchor="end">First overdraft</text>
        <line x1={l} x2={r} y1={60} y2={60} className="dx-zero" />
        <rect x={x(8)} y={46} width={x(21) - x(8)} height={28} className="dx-bar" />
        <line x1={x(13)} x2={x(13)} y1={40} y2={80} className="dx-median" />
        <text x={x(13)} y={98} className="dx-val" textAnchor="middle">median 13 months</text>
        {[0, 6, 12, 18, 24].map((m) => (
          <text key={m} x={x(m)} y={128} className="dx-axis" textAnchor="middle">{m} mo</text>
        ))}
        <rect x={l} y={136} width={(r - l) * 0.64} height={8} className="dx-bar is-hot" />
        <rect x={l + (r - l) * 0.64} y={136} width={(r - l) * 0.36} height={8} className="dx-bar is-dim" />
      </svg>
      <p className="dx-note">Grey band: middle half of accounts (8–21 months). Orange strip: 64% of the 288 overdrawn accounts had a near-miss first.</p>
    </>
  )
}

function RunwayBands({ before, after }) {
  const bands = [
    { k: 'Under 3 months', v: 17.7, lo: 0, hi: 3 },
    { k: '3–6 months', v: 3.7, lo: 3, hi: 6 },
    { k: '6–12 months', v: 1.7, lo: 6, hi: 12 },
    { k: '12+ months', v: 1.1, lo: 12, hi: Infinity },
  ]
  const inBand = (b, m) => m >= b.lo && m < b.hi
  return (
    <>
      <HBars rows={bands} max={18} fmt={(v) => `${v}%`} highlight={(b) => inBand(b, after)} />
      <p className="dx-note">
        Overdrawn in 2025 by runway-if-laid-off in 2024 (3,657 accounts). This customer moves from{' '}
        <strong>{bands.find((b) => inBand(b, before))?.k.toLowerCase()}</strong> to <strong>{bands.find((b) => inBand(b, after))?.k.toLowerCase()}</strong>.
      </p>
    </>
  )
}

function BeforeAfter({ before, after }) {
  const W = 720
  const H = 130
  const l = 130
  const max = Math.max(12, Math.ceil(after))
  const x = (m) => l + (Math.min(m, max) / max) * (W - l - 50)
  return (
    <>
      <svg className="dx-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Runway before and after">
        <text x={0} y={34} className="dx-label">After the shock</text>
        <rect x={l} y={20} width={Math.max(x(before) - l, 2)} height={22} className="dx-bar is-steel" />
        <text x={x(before) + 6} y={36} className="dx-val">{before.toFixed(1)}</text>
        <text x={0} y={80} className="dx-label">With guardrail</text>
        <rect x={l} y={66} width={Math.max(x(before) - l, 2)} height={22} className="dx-bar is-steel" />
        <rect x={x(before)} y={66} width={Math.max(x(after) - x(before), 2)} height={22} className="dx-bar is-hot" />
        <text x={x(after) + 6} y={82} className="dx-val">{after.toFixed(1)}</text>
        {[0, max / 2, max].map((m) => (
          <text key={m} x={x(m)} y={H - 8} className="dx-axis" textAnchor="middle">{Math.round(m)} mo</text>
        ))}
      </svg>
      <p className="dx-note">Months of runway, computed with the judges’ formula.</p>
    </>
  )
}
