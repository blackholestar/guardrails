import { useEffect, useMemo, useState } from 'react'
import { fetchAccount, fetchGlossary, planScenario } from './api'
import { runway, levers, money } from './runway'
import * as F from './data/findings'
import './dashboard.css'

const PRESETS = [
  { id: 'none', label: 'No shock', s: {} },
  { id: 'ei', label: 'Laid off, EI 55%', s: { income_multiplier: 0.55, income_months: 6 } },
  { id: 'furnace', label: 'Furnace dies', s: { one_off_months: 1 } },
  { id: 'ei-bills', label: 'Laid off + bills +15%', s: { income_multiplier: 0.55, income_months: 6, bills_pct: 0.15 } },
]
const DEFAULT = { income_multiplier: 1, income_months: 6, bills_pct: 0, one_off_cost: 0, extra_monthly: 0 }

const months = (r) => (typeof r.runway_label === 'string' && !/^\d/.test(r.runway_label) ? r.runway_label : `${Number(r.runway_months).toFixed(1)} mo`)
const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`

function readHash() {
  const [path, q] = window.location.hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(q || '')
  return { tab: path === 'findings' ? 'findings' : 'engine', account: params.get('account') }
}

export default function Dashboard() {
  const [route, setRoute] = useState(readHash)
  useEffect(() => {
    const on = () => setRoute(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  return (
    <div className="ds">
      <header className="ds-bar">
        <div className="ds-col ds-bar-in">
          <a className="ds-logo" href="#/">Guardrails</a>
          <nav className="ds-nav" aria-label="Sections">
            <a href="#/engine" aria-current={route.tab === 'engine' ? 'page' : undefined}>Engine</a>
            <a href="#/findings" aria-current={route.tab === 'findings' ? 'page' : undefined}>Findings</a>
          </nav>
          <span className="ds-scope">Tangerine track · 4,500 accounts</span>
        </div>
      </header>
      <main className="ds-col">{route.tab === 'findings' ? <Findings /> : <Engine initial={route.account} />}</main>
    </div>
  )
}

/* ============================== ENGINE ============================== */
function Engine({ initial }) {
  const [input, setInput] = useState(initial || '20134')
  const [id, setId] = useState(initial || '20134')
  const [shock, setShock] = useState({ ...DEFAULT, income_multiplier: 0.55 })
  const [oneOffMonths, setOneOffMonths] = useState(0)
  const [data, setData] = useState(null)
  const [glossary, setGlossary] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // Gemini reads a typed scenario into shock variables and proposes a plan; the engine does the math.
  const [aiText, setAiText] = useState('')
  const [ai, setAi] = useState(null)
  const [aiError, setAiError] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => { fetchGlossary().then(setGlossary).catch(() => {}) }, [])
  useEffect(() => { if (initial) { setInput(initial); setId(initial) } }, [initial])
  useEffect(() => { setAi(null); setAiError(null) }, [id])

  const toShock = (v) => ({
    income_multiplier: v.income_multiplier ?? 1,
    income_months: v.income_months ?? 6,
    bills_pct: v.bills_pct ?? 0,
    one_off_cost: v.one_off_cost ?? 0,
    extra_monthly: v.extra_monthly ?? 0,
  })

  async function readScenario(e) {
    e.preventDefault()
    const text = aiText.trim()
    if (!text || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const r = await planScenario(id, text)
      setAi(r)
      setOneOffMonths(0)
      setShock(toShock(r.impact.variables))
    } catch (err) {
      setAi(null)
      setAiError(`${err.message} The sliders and presets still work.`)
    } finally {
      setAiLoading(false)
    }
  }

  const effective = useMemo(() => {
    const s = { ...shock }
    if (data && oneOffMonths) s.one_off_cost = (s.one_off_cost || 0) + oneOffMonths * data.profile.S
    return s
  }, [shock, oneOffMonths, data])

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const d = await fetchAccount(id, { ...effective, one_off_cost: Math.round(effective.one_off_cost || 0) })
        if (live) { setData(d); setError(null) }
      } catch (e) {
        if (live) setError(e.status === 404 ? `No account ${id}. IDs run from 20111 to 99984.` : 'Cannot reach the engine. Start the backend: uvicorn src.api:app --port 8000')
      } finally {
        if (live) setLoading(false)
      }
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [id, effective])

  const set = (k) => (e) => setShock((s) => ({ ...s, [k]: Number(e.target.value) }))
  const applyPreset = (p) => {
    setShock({ ...DEFAULT, ...p.s, one_off_months: undefined })
    setOneOffMonths(p.s.one_off_months || 0)
  }

  const p = data?.profile
  const before = data?.baseline
  const after = data?.shocked
  const duration = shock.income_months || 6
  const prof = p && { I: p.I, S: p.S, B: p.B, H: p.H, F: p.F, P: p.P }
  const lv = prof ? levers(prof, effective) : []
  const afterN = after ? Number(after.runway_months) : 0
  const makesIt = after && afterN >= duration

  return (
    <>
      <div className="ds-title">
        <div>
          <h1>Account {id}</h1>
          {p && after && (
            <p className="ds-finding">
              {makesIt
                ? `Under this shock the savings last ${months(after)}, past the ${duration}-month mark.`
                : `Under this shock the savings last ${months(after)}, ${(duration - afterN).toFixed(1)} months short of ${duration}.`}
              {!makesIt && lv[0] && lv[0].after.months >= duration && ` Best move: ${lv[0].label.toLowerCase()} (${lv[0].after.label} months).`}
            </p>
          )}
        </div>
        <form className="ds-lookup" onSubmit={(e) => { e.preventDefault(); if (/^\d+$/.test(input)) setId(input) }}>
          <label htmlFor="acct" className="sr">Account ID</label>
          <input id="acct" inputMode="numeric" value={input} onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))} />
          <button className="btn-primary" type="submit">Look up</button>
        </form>
      </div>

      {error && <div className="ds-error" role="alert">{error}</div>}

      <section className="card ai-bar" aria-label="Describe what happened">
          <form className="ai-form ai-form-wide" onSubmit={readScenario}>
            <label htmlFor="scenario" className="ai-label">Describe what happened</label>
            <textarea
              id="scenario"
              rows={3}
              maxLength={2000}
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="Laid off, EI pays 55% for 6 months, and rent went up 15%"
            />
            <div className="ai-actions">
              <button className="btn-primary" type="submit" disabled={aiLoading || !aiText.trim()}>
                {aiLoading ? 'Reading…' : 'Read with Gemini'}
              </button>
              <span className="muted small">Gemini sets the sliders; the engine does the math.</span>
            </div>
            {aiError && <p className="ai-error" role="alert">{aiError}</p>}
            {ai && <p className="ai-read"><strong>Read as:</strong> {ai.impact_summary}</p>}
          </form>
      </section>

      <div className="grid-top">
        <section className="card runway-card" aria-labelledby="h-runway">
          <header className="card-h">
            <h2 id="h-runway">Runway</h2>
            <span className="muted">{loading ? 'Updating…' : 'Months of savings, README formula'}</span>
          </header>
          {before && after ? (
            <>
              <p className="hero-num">
                <span className="num">{months(after)}</span>
                <span className="rw-sub">from {months(before)} before the shock</span>
              </p>
              <RunwayChart before={before} after={after} duration={duration} />
              <p className={`status ${makesIt ? 'ok' : 'short'}`}>
                <span aria-hidden="true">{makesIt ? '▲' : '▼'}</span> {makesIt ? `Makes it through ${duration} months` : `Runs out before month ${duration}`}
              </p>
              <dl className="rw-work">
                <div><dt>Income</dt><dd className="num">{money(before.income_after)} &rarr; {money(after.income_after)}</dd></div>
                <div><dt>Spending</dt><dd className="num">{money(before.spending_after)} &rarr; {money(after.spending_after)}</dd></div>
                <div><dt>Monthly gap</dt><dd className="num">{after.gap > 0 ? money(after.gap) : 'None'}</dd></div>
                <div><dt>Savings to draw on</dt><dd className="num">{money(after.buffer_left)}</dd></div>
              </dl>
            </>
          ) : (
            <Skeleton />
          )}
        </section>

        <section className="card shock-card" aria-labelledby="h-shock">
          <header className="card-h"><h2 id="h-shock">Shock</h2></header>
          <div className="presets" role="group" aria-label="Preset shocks">
            {PRESETS.map((pr) => (
              <button key={pr.id} type="button" className="btn-secondary" onClick={() => applyPreset(pr)}>{pr.label}</button>
            ))}
          </div>
          <Slider id="inc" label="Income kept" value={shock.income_multiplier} min={0} max={1} step={0.05} fmt={(v) => pct(v)} onChange={set('income_multiplier')} />
          <Slider id="dur" label="Shock lasts" value={shock.income_months} min={1} max={12} step={1} fmt={(v) => `${v} mo`} onChange={set('income_months')} />
          <Slider id="bills" label="Household bills" value={shock.bills_pct} min={0} max={0.5} step={0.05} fmt={(v) => `+${pct(v)}`} onChange={set('bills_pct')} />
          <Slider id="extra" label="Extra each month" value={shock.extra_monthly} min={-2000} max={2000} step={50} fmt={money} onChange={set('extra_monthly')} />
          <Slider id="once" label="One-off cost" value={shock.one_off_cost} min={0} max={20000} step={250} fmt={money} onChange={set('one_off_cost')} />
          {oneOffMonths > 0 && p && <p className="muted small">Plus a repair of one month&rsquo;s spending: {money(p.S)}.</p>}
        </section>
      </div>

      <div className="grid-mid">
        <section className="card" aria-labelledby="h-levers">
          <header className="card-h"><h2 id="h-levers">Moves that buy time</h2><span className="muted">Ranked for this customer, on top of the shock</span></header>
          {p ? (
            <table className="tbl">
              <thead><tr><th scope="col">Move</th><th scope="col" className="r">Runway</th><th scope="col" className="r">Gained</th></tr></thead>
              <tbody>
                {lv.map((l) => (
                  <tr key={l.id}>
                    <td><span className="row-t">{l.label}</span><span className="row-s">{l.detail}</span></td>
                    <td className="r num">{l.after.noShortfall ? 'No shortfall' : `${l.after.label} mo`}</td>
                    <td className="r num">{l.after.noShortfall ? '—' : `+${Math.max(l.gained, 0).toFixed(1)} mo`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Skeleton rows={3} />}
        </section>

        <section className="card" aria-labelledby="h-profile">
          <header className="card-h"><h2 id="h-profile">Typical month</h2><span className="muted">{p ? `${p.months_history} months of history` : ''}</span></header>
          {p ? (
            <table className="tbl">
              <tbody>
                <Row k="Money in (I)" v={money(p.I)} />
                <Row k="Spending (S)" v={money(p.S)} />
                <Row k="Fixed costs (F)" v={money(p.F)} />
                <Row k="Household bills (H)" v={p.H ? money(p.H) : '—'} />
                <Row k="Loan payment (P)" v={p.P ? money(p.P) : '—'} />
                <Row k="Savings buffer (B)" v={money(p.B)} strong />
              </tbody>
            </table>
          ) : <Skeleton rows={6} />}
          {data?.flags?.length > 0 && (
            <ul className="flags">
              {data.flags.map((f) => <li key={f}>{glossary?.flags?.[f] ?? f}</li>)}
            </ul>
          )}
        </section>
      </div>

      {ai && <AiPlan ai={ai} onApply={() => setShock(toShock(ai.plan.variables))} />}
      {p && <Plan p={prof} shock={effective} duration={duration} />}
    </>
  )
}

// Gemini's plan for the typed scenario. Runway figures come from the engine (src/service.py plan_scenario).
const VAR_LABELS = {
  income_multiplier: ['Income received', (v) => pct(v)],
  income_months: ['Lasts', (v) => (v == null ? 'Indefinitely' : `${v} mo`)],
  bills_pct: ['Household bills', (v) => `${v > 0 ? '+' : ''}${pct(v)}`],
  one_off_cost: ['One-off cost', money],
  extra_monthly: ['Monthly spending change', (v) => `${v > 0 ? '+' : ''}${money(v)}`],
}

function AiPlan({ ai, onApply }) {
  const imp = ai.impact.variables
  const pv = ai.plan.variables
  return (
    <section className="card ai-plan" aria-labelledby="h-aiplan">
      <header className="card-h">
        <h2 id="h-aiplan">Gemini&rsquo;s plan</h2>
        <span className="muted">&ldquo;{ai.scenario}&rdquo;</span>
      </header>
      <div className="ai-cols">
        <div>
          <p className="ai-desc">{ai.plan.description}</p>
          <p className="muted ai-why"><strong>Why:</strong> {ai.plan.justification}</p>
          <button type="button" className="btn-secondary" onClick={onApply}>Apply plan to the sliders</button>
        </div>
        <div>
          <table className="tbl">
            <thead><tr><th scope="col">Runway</th><th scope="col" className="r">Months</th></tr></thead>
            <tbody>
              <tr><th scope="row">Before</th><td className="r num">{months(ai.baseline)}</td></tr>
              <tr><th scope="row">After the event</th><td className="r num">{months(ai.impact.result)}</td></tr>
              <tr><th scope="row">With the plan</th><td className="r num strong">{months(ai.plan.result)}</td></tr>
            </tbody>
          </table>
          <table className="tbl ai-vars">
            <thead><tr><th scope="col">Variable</th><th scope="col" className="r">Event</th><th scope="col" className="r">Plan</th></tr></thead>
            <tbody>
              {Object.entries(VAR_LABELS).map(([k, [label, fmt]]) => (
                <tr key={k}><th scope="row">{label}</th><td className="r num">{fmt(imp[k])}</td><td className="r num">{fmt(pv[k])}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small ai-model">Generated by {ai.model}. An estimate, not financial advice.</p>
    </section>
  )
}

function Plan({ p, shock, duration }) {
  const surplus = p.I - p.S
  const eiGap = Math.max(p.S - 0.55 * p.I, 0)
  const target = Math.max(3 * p.S, 6 * eiGap)
  const short = Math.max(target - p.B, 0)
  const save = surplus > 0 ? surplus / 2 : 0
  const monthsToGoal = save > 0 ? Math.ceil(short / save) : null
  const r = runway(p, shock)
  return (
    <section className="card plan" aria-labelledby="h-plan">
      <header className="card-h"><h2 id="h-plan">Plan</h2><span className="muted">Preview, computed in the browser from the same formula</span></header>
      <div className="plan-cols">
        <div>
          <h3>Goal: an emergency fund</h3>
          <p className="plan-num num">{money(target)}</p>
          <p>
            {short === 0
              ? 'Already funded. Keep it untouched for emergencies.'
              : save > 0
                ? `Short by ${money(short)}. Saving ${money(save)} a month (half the usual surplus) gets there in about ${monthsToGoal} months.`
                : `Short by ${money(short)}, and spending already exceeds income by ${money(-surplus)} a month. First close that gap.`}
          </p>
        </div>
        <div>
          <h3>Backup: if the shock hits</h3>
          <p className="plan-num num">{r.noShortfall ? 'No shortfall' : `${r.label} months`}</p>
          <p>
            {r.noShortfall || r.months >= duration
              ? `Savings outlast the ${duration}-month shock.`
              : `To last ${duration} months, spending must fall by about ${money(r.spending - (r.income + r.left / duration))} a month. Start with the top move on the left.`}
          </p>
        </div>
      </div>
    </section>
  )
}

function RunwayChart({ before, after, duration }) {
  const cap = 12
  const val = (r) => Math.min(Number(r.runway_months) || 0, cap)
  const capped = (r) => Number(r.runway_months) > cap || /shortfall/i.test(String(r.runway_label))
  const W = 640, H = 120, L = 70, R = 44
  const x = (v) => L + (v / cap) * (W - L - R)
  const bars = [
    { k: 'Before', v: val(before), c: capped(before), hue: false, y: 18 },
    { k: 'After', v: val(after), c: capped(after), hue: true, y: 62 },
  ]
  return (
    <svg className="runway-svg" viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={`Runway before ${months(before)}, after ${months(after)}; the line marks ${duration} months`}>
      {[0, 3, 6, 9, 12].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={8} y2={H} className="grid" />
          <text x={x(t)} y={H + 18} className="tick" textAnchor="middle">{t === 12 ? '12+ mo' : t}</text>
        </g>
      ))}
      {bars.map((b) => (
        <g key={b.k}>
          <text x={0} y={b.y + 22} className="lab">{b.k}</text>
          <rect x={x(0)} y={b.y} width={Math.max(x(b.v) - x(0), 2)} height={34} rx={4} className={b.hue ? 'bar-hue' : 'bar-ink'} />
        </g>
      ))}
      <line x1={x(duration)} x2={x(duration)} y1={4} y2={H} className="mark" />
      <text x={x(duration) + 6} y={12} className="mark-t">{duration} months</text>
    </svg>
  )
}

function Slider({ id, label, value, min, max, step, fmt, onChange }) {
  return (
    <div className="sl">
      <label htmlFor={id}>{label}<output htmlFor={id} className="num">{fmt(value)}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={onChange} />
    </div>
  )
}
const Row = ({ k, v, strong }) => (
  <tr><th scope="row">{k}</th><td className={`r num${strong ? ' strong' : ''}`}>{v}</td></tr>
)
const Skeleton = ({ rows = 2 }) => <div className="skel" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <span key={i} />)}</div>

/* ============================== FINDINGS ============================== */
function Findings() {
  return (
    <>
      <div className="ds-title">
        <div>
          <h1>What predicts trouble</h1>
          <p className="ds-finding">One job loss on EI leaves 35.5% of customers out of savings within 6 months. Steady income and a healthy worst day matter more than high pay.</p>
        </div>
      </div>
      <div className="grid-two">
        <ChartCard title="Out of savings within 6 months" note="All 4,500 accounts, by shock">
          <Bars data={F.shocks.map((d) => ({ k: d.label, v: d.share }))} fmt={(v) => pct(v, 1)} max={0.5} hueIndex={1} />
        </ChartCard>
        <ChartCard title="Higher earners last less long" note="Working customers who survive 6 months on EI">
          <Bars data={F.incomeSurvival.map((d) => ({ k: `${d.label} (${money(d.income)})`, v: d.survives }))} fmt={(v) => pct(v)} max={1} hueIndex={2} />
        </ChartCard>
        <ChartCard title="Steady income beats high income" note="Loan default rate, 615 loans">
          <Bars
            data={[
              { k: 'Lower income, steady', v: F.steadiness.lower.steady },
              { k: 'Lower income, unsteady', v: F.steadiness.lower.unsteady },
              { k: 'Higher income, steady', v: F.steadiness.higher.steady },
              { k: 'Higher income, unsteady', v: F.steadiness.higher.unsteady },
            ]}
            fmt={(v) => pct(v, 1)} max={0.3} hueIndex={3}
          />
        </ChartCard>
        <ChartCard title="The worst day predicts default" note="Lowest balance in the 12 months before the loan">
          <Bars data={F.worstDay.map((d) => ({ k: `${d.label} (${d.n} loans)`, v: d.rate }))} fmt={(v) => pct(v, 1)} max={0.25} hueIndex={0} />
        </ChartCard>
        <ChartCard title="January is the riskiest month" note="Median money out per account, by month">
          <Months />
        </ChartCard>
        <ChartCard title="Borrowers are more fragile" note="Survive 6 months on EI, by loan status">
          <Bars data={F.loanSurvival.map((d) => ({ k: d.label, v: d.share }))} fmt={(v) => pct(v)} max={0.8} hueIndex={4} />
        </ChartCard>
      </div>
      <p className="muted small foot-note">Data: PKDD&rsquo;99 Financial dataset (anonymized bank data, converted to CAD with shifted dates). Lowest income quarter left out of the earnings chart: 29% of it holds over 12 months of savings, which looks like side accounts.</p>
    </>
  )
}

function ChartCard({ title, note, children }) {
  return (
    <section className="card">
      <header className="card-h"><h2>{title}</h2><span className="muted">{note}</span></header>
      {children}
    </section>
  )
}

function Bars({ data, fmt, max, hueIndex }) {
  return (
    <div className="hbars">
      {data.map((d, i) => (
        <div className="hb" key={d.k}>
          <span className="hb-k">{d.k}</span>
          <span className="hb-track"><span className={`hb-fill ${i === hueIndex ? 'hue' : ''}`} style={{ width: `${Math.min(d.v / max, 1) * 100}%` }} /></span>
          <span className="hb-v num">{fmt(d.v)}</span>
        </div>
      ))}
    </div>
  )
}

function Months() {
  const W = 560, H = 170, L = 44, B = 22, max = 12000
  const x = (i) => L + i * ((W - L - 8) / 11)
  const y = (v) => 8 + (1 - v / max) * (H - B - 8)
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="months-svg" role="img" aria-label="Median spending peaks in January at $11,518">
      {[0, 4000, 8000, 12000].map((t) => (
        <g key={t}><line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 4} className="tick" textAnchor="end">{t / 1000}k</text></g>
      ))}
      <path d={path(F.seasonIn)} className="line-ink" />
      <path d={path(F.seasonOut)} className="line-hue" />
      {F.months.map((m, i) => <text key={m} x={x(i)} y={H - 4} className="tick" textAnchor="middle">{m}</text>)}
      <circle cx={x(0)} cy={y(F.seasonOut[0])} r={4} className="dot-hue" />
      <text x={x(0) + 10} y={y(F.seasonOut[0]) + 4} className="lab">$11,518 out</text>
      <text x={x(11)} y={y(F.seasonIn[11]) - 8} className="tick" textAnchor="end">money in</text>
    </svg>
  )
}
