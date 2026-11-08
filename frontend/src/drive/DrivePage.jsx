import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAccount, planScenario } from '../api'
import { runway, money } from '../runway'
import { useCustomer } from '../customer/customerApi'
import ACCOUNT_IDS from '../data/account_ids.json'
import './drive.css'

// The engine page: a grid of result cards (empty until Go) over a quiet grid-paper background, and a console at the bottom.
// The profile (I, S, B, H, P) comes from the backend; runway is the judges' formula (runway.js mirrors src/engine.py),
// so sliders and guardrail switches update instantly.

const VALID = new Set(ACCOUNT_IDS)
const NO_SHOCK = { income_multiplier: 1, income_months: null, bills_pct: 0, one_off_cost: 0, extra_monthly: 0 }

const PRESETS = [
  { label: 'Laid off on EI', text: 'Laid off, EI pays 55% for 6 months', shock: { income_multiplier: 0.55, income_months: 6 } },
  { label: 'Bills up 15%', text: 'Household bills go up 15%', shock: { bills_pct: 0.15 } },
  { label: 'Furnace dies', text: 'The furnace dies; the repair costs a month of spending', shock: { one_off_cost: 'S' } },
  {
    label: 'Laid off + bills up 15%',
    text: 'Laid off with EI at 55%, and household bills go up 15% the same month',
    shock: { income_multiplier: 0.55, income_months: 6, bills_pct: 0.15 },
  },
]

// Plain rules for a typed twist card, used when Gemini is unavailable.
function readTwistLocally(text, S) {
  const t = text.toLowerCase()
  const s = {}
  if (/laid off|lost (my|their|his|her)? ?job|job loss|fired|unemploy|\bei\b/.test(t)) s.income_multiplier = 0.55
  const pct = t.match(/(\d+)\s*%/)
  if (s.income_multiplier && pct && /ei|pays|benefit/.test(t) && !/bill|rent|utilit/.test(t.slice(t.indexOf(pct[0]) - 20, t.indexOf(pct[0]))))
    s.income_multiplier = Number(pct[1]) / 100
  const months = t.match(/(\d+)\s*months?/)
  if (s.income_multiplier && months) s.income_months = Number(months[1])
  else if (s.income_multiplier) s.income_months = 6
  const bills = t.match(/(?:bills?|rent|utilit\w*)[^0-9%]{0,30}(\d+)\s*%/)
  if (bills) s.bills_pct = Number(bills[1]) / 100
  const cost = t.match(/\$\s*([\d,]+)/)
  if (cost) s.one_off_cost = Number(cost[1].replace(/,/g, ''))
  else if (/month of (their |typical )?spending|full month/.test(t) && /repair|furnace|car|cost/.test(t)) s.one_off_cost = S
  return s
}

const fmtMonths = (r) => (r.noShortfall ? 'No shortfall' : `${r.label} months`)

function describeShock(s) {
  const parts = []
  if (s.income_multiplier < 1) parts.push(`income at ${Math.round(s.income_multiplier * 100)}%${s.income_months ? ` for ${s.income_months} months` : ''}`)
  if (s.bills_pct) parts.push(`bills ${s.bills_pct > 0 ? 'up' : 'down'} ${Math.round(Math.abs(s.bills_pct) * 100)}%`)
  if (s.one_off_cost) parts.push(`a ${money(s.one_off_cost)} one-off cost`)
  if (s.extra_monthly) parts.push(`${money(Math.abs(s.extra_monthly))} a month ${s.extra_monthly > 0 ? 'more' : 'less'} spending`)
  return parts
}

// A plan action from the backend (src/actions.py) becomes a guardrail: what the bank switches on,
// or a step only the customer can take. `save` is how much it narrows the monthly gap.
function railFromAction(a, i) {
  const amt = money(a.monthly_amount)
  const m = a.metric_changes || {}
  const save = -(m.S || 0) + (m.I || 0)
  const map = {
    cash_withdrawals: [`Lower the cash limit by ${amt} a month`, 'Bank, automatic'],
    card_spending: [`Card spending cap: ${amt} a month less`, 'Bank, automatic'],
    transfers_out:
      a.kind === 'change_commitment'
        ? [`Pause a standing order (${amt} a month)`, 'Bank, automatic']
        : [`Hold large outgoing transfers (${amt} a month)`, 'Bank, automatic'],
    bank_fees: [`Low-balance alert to avoid ${amt} of fees`, 'Bank, automatic'],
    loan_payment: [`Loan deferral request (${amt} a month)`, 'Bank sends, lender approves'],
    household_bills: [`Renegotiate household bills (${amt} a month)`, 'Customer step'],
    insurance: [`Review insurance (${amt} a month)`, 'Customer step'],
    income: [`Extra income goal (${amt} a month)`, 'Customer step'],
  }
  const [label, who] = map[a.category] || [a.title, 'Customer step']
  const kind =
    {
      cash_withdrawals: 'cash_limit',
      card_spending: 'card_cap',
      transfers_out: a.kind === 'change_commitment' ? 'standing_order' : 'transfer_hold',
      bank_fees: 'balance_alert',
      loan_payment: 'loan_deferral',
    }[a.category] || 'customer_step'
  return { id: `a${i}`, kind, amount: a.monthly_amount, label, who, save, how: a.how, evidence: a.evidence, capped: a.status === 'capped' }
}

// The Guardian agent (src/agent.py): carries out one approved guardrail with rule-checked tool calls.
async function callAgent(accountId, rail, opts = {}) {
  const res = await fetch('/api/agent/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_id: Number(accountId),
      guardrail: { id: rail.id, kind: rail.kind, label: rail.label.slice(0, 200), amount: rail.amount || 0 },
      ...opts,
    }),
  })
  if (!res.ok) throw new Error(`Agent request failed (${res.status})`)
  return res.json()
}

const fmtArgs = (args) =>
  Object.entries(args || {})
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? (k === 'months' ? v : `$${Math.round(v).toLocaleString('en-CA')}`) : v}`)
    .join(', ')

function openStory() {
  window.location.hash = '#/'
}

const TRACK_MAX = 12 // months shown on the track

// Counts a number up (or down) to its target, so a new result reads as freshly calculated.
function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (target == null) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (now) => {
      const k = reduce ? 1 : Math.min((now - start) / ms, 1)
      const e = 1 - Math.pow(1 - k, 3)
      const x = a + (target - a) * e
      from.current = x
      setV(x)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

// The runway as a road: one tick per month, steel for the customer's own savings,
// orange for the months guardrails add, and a marker at the goal.
function RunwayTrack({ steel, total, goal }) {
  const pct = (m) => `${(Math.min(Math.max(m, 0), TRACK_MAX) / TRACK_MAX) * 100}%`
  const empty = steel == null
  return (
    <div className={`dv-track${empty ? ' is-empty' : ''}`}>
      <div className="dv-track-road">
        {!empty && (
          <>
            <div className="dv-seg dv-seg-steel" style={{ width: pct(steel) }} />
            <div className="dv-seg dv-seg-orange" style={{ left: pct(steel), width: pct(Math.max(total - steel, 0)) }} />
          </>
        )}
        <div className="dv-goal" style={{ left: pct(goal) }}>
          <span>Goal: {goal} months</span>
        </div>
      </div>
      <div className="dv-ticks" aria-hidden="true">
        {Array.from({ length: TRACK_MAX + 1 }, (_, i) => (
          <span key={i} style={{ left: pct(i) }}>{i === TRACK_MAX ? '12+' : i}</span>
        ))}
      </div>
      <p className="dv-track-key">
        <span className="dv-key dv-key-steel" /> Their own savings
        <span className="dv-key dv-key-orange" /> Added by guardrails
      </p>
    </div>
  )
}

function Skeleton({ lines = 2, big = false }) {
  return (
    <div className="dv-skel" aria-hidden="true">
      {big && <span className="dv-skel-big" />}
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ width: `${88 - i * 22}%` }} />
      ))}
    </div>
  )
}

export default function DrivePage({ initialAccount }) {
  const [acct, setAcct] = useState(initialAccount && /^\d+$/.test(initialAccount) ? initialAccount : '')
  const [twist, setTwist] = useState('')
  const [readTwist, setReadTwist] = useState('') // the twist text the current shock came from
  const [profile, setProfile] = useState(null)
  const [meta, setMeta] = useState(null)
  const [shock, setShock] = useState(NO_SHOCK)
  const [source, setSource] = useState(null) // 'ai' | 'rules' | 'preset' | 'manual'
  const [plan, setPlan] = useState(null)
  const [on, setOn] = useState({}) // which guardrails are switched on, by id
  const [agentLog, setAgentLog] = useState([]) // the Guardian's tool calls, newest first
  const [pending, setPending] = useState('') // guardrail id the agent is working on
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [adjust, setAdjust] = useState(false)

  // ---------- numbers (judges' formula) ----------
  const c = profile
  // payments made in the demo stores, which the Guardian reviewed (polled from the customer sandbox)
  const { state: shopper } = useCustomer(profile?.id)
  const payments = [...(shopper?.purchases || [])].reverse()
  const hasShock =
    shock.income_multiplier !== 1 || shock.bills_pct !== 0 || shock.one_off_cost !== 0 || shock.extra_monthly !== 0

  // Guardrails are the plan, enforced: each action in Gemini's plan becomes one.
  // Without a plan (presets, sliders, AI down) two standard ones stand in.
  const rails = useMemo(() => {
    if (!c) return []
    if (plan?.actions?.length) {
      return plan.actions.filter((a) => a.status !== 'rejected' && a.monthly_amount > 0.5).map(railFromAction)
    }
    const out = []
    if (c.P > 0)
      out.push({ id: 'loan', kind: 'loan_deferral', amount: c.P, label: `Loan deferral request: pause the ${money(c.P)} payment`, who: 'Bank sends, lender approves', save: c.P })
    out.push({ id: 'cash', kind: 'cash_limit', amount: 300, label: 'Lower the cash limit by $300 a month', who: 'Bank, automatic', save: 300 })
    return out
  }, [c, plan])

  const r = useMemo(() => {
    if (!c) return null
    const shocked = runway(c, shock)
    const withSave = (sv) => runway(c, { ...shock, extra_monthly: (shock.extra_monthly || 0) - sv })
    const saving = rails.reduce((t, x) => t + (on[x.id] ? x.save : 0), 0)
    return {
      base: runway(c),
      shocked,
      guarded: withSave(saving),
      alone: Object.fromEntries(rails.map((x) => [x.id, Math.max(withSave(x.save).months - shocked.months, 0)])),
    }
  }, [c, shock, on, rails])

  const anyGuard = rails.some((x) => on[x.id])
  const final = r ? (anyGuard ? r.guarded : r.shocked) : null
  const goal = shock.income_months || 6

  // Guardrails are real actions, so they never switch on by themselves: they start off whenever the
  // shock or plan changes, and the next one to apply pulses to invite a click.
  const railKey = c ? `${c.id}|${JSON.stringify(shock)}|${rails.map((x) => x.id + x.save).join()}` : ''
  const lastRailKey = useRef('')
  useEffect(() => {
    if (lastRailKey.current === railKey) return
    lastRailKey.current = railKey
    const t = setTimeout(() => setOn({}), 0)
    return () => clearTimeout(t)
  }, [railKey])
  const nextRail = rails.find((x) => !on[x.id])?.id

  async function toggleRail(x, opts = {}) {
    if (pending) return
    const turningOn = opts.simulate_attack ? true : !on[x.id]
    setPending(x.id)
    try {
      const d = await callAgent(c.id, x, { ...(turningOn ? opts : { undo: true }), shock })
      const entries = d.events.map((e, i) => ({ ...e, key: `${Date.now()}-${i}`, rail: x.label, source: d.source }))
      const real = entries.filter((e) => !e.simulated)
      if (!opts.simulate_attack || !on[x.id]) setAgentLog((l) => [...real.reverse(), ...l].slice(0, 14))
      const applied = d.events.some((e) => e.status === 'applied' && !e.simulated)
      if (turningOn && applied) setOn((o) => ({ ...o, [x.id]: true }))
      if (!turningOn) setOn((o) => ({ ...o, [x.id]: false }))
    } catch {
      // agent unreachable: apply the setting locally and say so
      setAgentLog((l) => [
        { key: `${Date.now()}`, tool: turningOn ? 'apply' : 'undo', args: {}, status: 'applied', detail: `${x.label} (agent unreachable, applied directly)`, rail: x.label, source: 'local' },
        ...l,
      ])
      setOn((o) => ({ ...o, [x.id]: turningOn }))
    } finally {
      setPending('')
    }
  }

  const steel = r ? (hasShock ? r.shocked : r.base) : null
  const shownMonths = useCountUp(final ? Math.min(final.months, 120) : null)
  const bigLabel = !final ? '' : final.noShortfall || final.months >= 120 ? '120+' : shownMonths.toFixed(1)

  // ---------- actions ----------
  async function loadAccount(id) {
    setBusy('Pulling the account…')
    setError('')
    try {
      const d = await fetchAccount(id)
      setProfile({ ...d.profile, id: d.account_id })
      setMeta({ ...d.profile, flags: d.flags })
      setShock(NO_SHOCK)
      setSource(null)
      setPlan(null)
      setReadTwist('')
      setOn({})
      setAgentLog([])
      // start the sandbox fresh too: no payments or limits from an earlier run
      fetch(`/api/customer/${d.account_id}/reset`, { method: 'POST' }).catch(() => {})
      return d.profile
    } catch (err) {
      setError(err.status === 404 ? `There is no account ${id}.` : `Couldn't reach the engine: ${err.message}`)
      return null
    } finally {
      setBusy('')
    }
  }

  async function applyTwist(id, text, prof) {
    setBusy('Reading the twist card…')
    try {
      const d = await planScenario(id, text)
      setShock({ ...NO_SHOCK, ...d.impact.variables })
      setPlan({
        description: d.plan.description,
        justification: d.plan.justification,
        result: d.plan.result,
        actions: d.plan.actions || [],
        risks: d.plan.risks || [],
      })
      setSource('ai')
    } catch {
      setShock({ ...NO_SHOCK, ...readTwistLocally(text, prof.S) })
      setPlan(null)
      setSource('rules')
    } finally {
      setReadTwist(text)
      setBusy('')
    }
  }

  async function go(e) {
    e?.preventDefault()
    if (busy) return
    const id = acct.trim()
    if (!id) return setError('Type an account ID first.')
    if (!VALID.has(Number(id))) return setError(`There is no account ${id}. IDs run from 20111 to 99984.`)
    let prof = profile
    if (!profile || String(profile.id) !== id) {
      prof = await loadAccount(id)
      if (!prof) return
    }
    const text = twist.trim()
    if (text && text !== readTwist) await applyTwist(id, text, prof)
    if (!text && readTwist) {
      setShock(NO_SHOCK)
      setReadTwist('')
      setSource(null)
      setPlan(null)
    }
  }

  function applyPreset(p) {
    if (!profile) return
    const s = { ...NO_SHOCK, ...p.shock }
    if (s.one_off_cost === 'S') s.one_off_cost = Math.round(profile.S)
    setTwist(p.text)
    setReadTwist(p.text)
    setShock(s)
    setSource('preset')
    setPlan(null)
  }

  function setShockField(k, v) {
    setShock((s) => ({ ...s, [k]: v }))
    setSource('manual')
    setPlan(null)
  }

  // arriving from the landing page with an account: build the road straight away
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !initialAccount || !VALID.has(Number(initialAccount))) return
    // mark it done only when it actually fires (dev mode mounts effects twice and cancels the first timer)
    const t = setTimeout(() => {
      autoRan.current = true
      go()
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shockParts = describeShock(shock)
  const sourceNote = { ai: 'read by Gemini', rules: 'read with simple rules (AI unavailable)', preset: 'preset', manual: 'adjusted by hand' }[source]

  const loanWord = { A: 'Repaid', B: 'Defaulted', C: 'Running, OK', D: 'Running, in debt' }
  const ready = !!r

  return (
    <div className="dv">
      <header className="dv-bar">
        <a className="dv-mark" href="#/">Guardrails</a>
        <nav className="dv-nav" aria-label="Pages">
          <button type="button" className="dv-navlink" onClick={openStory}>The story</button>
          <a className="dv-navlink" href={`#/classic${profile ? `?account=${profile.id}` : ''}`}>Classic view</a>
        </nav>
      </header>

      <main className="dv-main">
        <div className="dv-head">
          <h1 className="dv-title">{ready ? `Account ${profile.id}` : 'Runway engine'}</h1>
          <p className="dv-sub">
            {ready
              ? `${meta.district}, ${meta.region} · owner ${Math.round(meta.owner_age)} · ${meta.months_history} months of history`
              : 'Enter any of the 4,500 accounts below and press Go. Numbers use the judges’ formulas.'}
          </p>
        </div>

        <div className={`dv-grid${ready ? ' is-ready' : ''}`} aria-live="polite">
          {/* the customer, known before any shock: one strip of figures */}
          <section className="dv-card dv-card-strip" aria-labelledby="c-strip">
            <h2 id="c-strip" className="dv-label">The customer each month</h2>
            {!ready ? (
              <dl className="dv-strip" aria-hidden="true">
                {['Income (I)', 'Spending (S)', 'Bills (H)', 'Loan payment (P)', 'Fixed costs (F)', 'Savings (B)', 'Monthly gap'].map((k) => (
                  <div key={k} className="dv-cell">
                    <dt>{k}</dt>
                    <dd><span className="dv-skel-cell" /></dd>
                  </div>
                ))}
              </dl>
            ) : (
              <dl className="dv-strip">
                <div className="dv-cell">
                  <dt>Income (I)</dt>
                  <dd>{money(r.shocked.income)}{hasShock && r.shocked.income !== c.I ? <s>{money(c.I)}</s> : null}</dd>
                </div>
                <div className="dv-cell">
                  <dt>Spending (S)</dt>
                  <dd>
                    {money(final.spending)}
                    {(hasShock || anyGuard) && Math.abs(final.spending - c.S) > 0.5 ? <s>{money(c.S)}</s> : null}
                  </dd>
                </div>
                <div className="dv-cell">
                  <dt>Bills (H)</dt>
                  <dd>{money(c.H)}</dd>
                </div>
                <div className="dv-cell">
                  <dt>Loan payment (P)</dt>
                  <dd>{c.P ? money(c.P) : 'None'}<small>{meta.loan_status ? loanWord[meta.loan_status] : 'No loan'}</small></dd>
                </div>
                <div className="dv-cell">
                  <dt>Fixed costs (F)</dt>
                  <dd>{money(meta.F)}</dd>
                </div>
                <div className="dv-cell">
                  <dt>Savings (B)</dt>
                  <dd>{money(Math.max(r.shocked.left, 0))}{shock.one_off_cost ? <s>{money(c.B)}</s> : null}</dd>
                </div>
                <div className="dv-cell dv-cell-gap">
                  <dt>Monthly gap</dt>
                  <dd>{final.spending - r.shocked.income > 0 ? money(final.spending - r.shocked.income) : 'None'}</dd>
                </div>
              </dl>
            )}
            {ready && meta.flags?.includes('no_bills') && <p className="dv-note">No labelled household bills for this account, so a bill shock has no effect.</p>}
          </section>

          {/* runway */}
          <section className="dv-card dv-card-runway" aria-labelledby="c-runway">
            <h2 id="c-runway" className="dv-label">Runway</h2>
            {!ready ? (
              <Skeleton big lines={2} />
            ) : (
              <>
                <p className="dv-big">
                  {bigLabel}
                  <span className="dv-big-unit">months</span>
                </p>
                <p className="dv-line">
                  {hasShock
                    ? `With ${shockParts.join(', ')}.`
                    : final.noShortfall
                      ? 'Income covers spending today, so savings never run down.'
                      : 'At today’s income and spending.'}
                  {hasShock && anyGuard ? ` Guardrails add ${(r.guarded.months - r.shocked.months).toFixed(1)} months.` : ''}
                  {hasShock && !anyGuard ? ` Before the shock: ${fmtMonths(r.base)}.` : ''}
                </p>
                {hasShock && shock.income_months ? (
                  <p className={`dv-verdict ${final.months >= goal ? 'ok' : 'short'}`}>
                    {final.months >= goal
                      ? `Makes it through the ${goal} months`
                      : `Runs out ${(goal - final.months).toFixed(1)} months early`}
                  </p>
                ) : null}
              </>
            )}
          </section>

          {/* the road */}
          <section className="dv-card dv-card-track" aria-labelledby="c-track">
            <h2 id="c-track" className="dv-label">Months of savings</h2>
            <RunwayTrack steel={ready ? steel.months : null} total={ready ? final.months : null} goal={goal} />
          </section>

          {/* shock and guardrails */}
          <section className="dv-card dv-card-controls" aria-labelledby="c-controls">
            <h2 id="c-controls" className="dv-label">The shock</h2>
            {!ready ? (
              <Skeleton lines={3} />
            ) : (
              <div className="dv-controls">
      <div className="dv-row dv-row-small">
        <span className="dv-chips-label">Shock</span>
        {hasShock ? (
          <span className="dv-chips">
            {shockParts.map((p) => (
              <span key={p} className="dv-chip">{p}</span>
            ))}
            {sourceNote && <span className="dv-src">{sourceNote}</span>}
          </span>
        ) : (
          <span className="dv-chips">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="dv-preset" onClick={() => applyPreset(p)}>
                {p.label}
              </button>
            ))}
          </span>
        )}
        <button type="button" className="dv-adjust" aria-expanded={adjust} onClick={() => setAdjust((a) => !a)}>
          {adjust ? 'Hide' : 'Adjust'}
        </button>
      </div>

      {adjust && (
        <div className="dv-sliders">
          <label>
            <span>Income kept <output>{Math.round(shock.income_multiplier * 100)}%</output></span>
            <input type="range" min="0" max="100" step="5" value={Math.round(shock.income_multiplier * 100)} onChange={(e) => setShockField('income_multiplier', Number(e.target.value) / 100)} />
          </label>
          <label>
            <span>For <output>{shock.income_months ?? 6} months</output></span>
            <input type="range" min="1" max="12" step="1" value={shock.income_months ?? 6} onChange={(e) => setShockField('income_months', Number(e.target.value))} />
          </label>
          <label>
            <span>Bills <output>{shock.bills_pct >= 0 ? '+' : ''}{Math.round(shock.bills_pct * 100)}%</output></span>
            <input type="range" min="-20" max="50" step="5" value={Math.round(shock.bills_pct * 100)} onChange={(e) => setShockField('bills_pct', Number(e.target.value) / 100)} />
          </label>
          <label>
            <span>One-off cost <output>{money(shock.one_off_cost)}</output></span>
            <input type="range" min="0" max="20000" step="250" value={shock.one_off_cost} onChange={(e) => setShockField('one_off_cost', Number(e.target.value))} />
          </label>
        </div>
      )}

              </div>
            )}
          </section>

          {/* the output: the plan, on its own row */}
          <section className="dv-card dv-card-plan" aria-labelledby="c-plan">
            <h2 id="c-plan" className="dv-label">The plan</h2>
            {!ready ? (
              <Skeleton lines={3} />
            ) : plan ? (
              <div className="dv-plan">
                <div className="dv-plan-side">
                  <p className="dv-plan-num">
                    {typeof plan.result.runway_label === 'string' ? plan.result.runway_label : `${plan.result.runway_label.toFixed(1)}`}
                    {typeof plan.result.runway_label === 'string' ? null : <span className="dv-plan-unit"> months</span>}
                  </p>
                  <p className="dv-plan-meta">runway with Gemini&rsquo;s plan, up from {r.shocked.label} after the shock (checked by the engine)</p>
                  <p className={`dv-verdict ${plan.result.runway_months >= goal ? 'ok' : 'short'}`}>
                    {plan.result.runway_months >= goal ? `Reaches the ${goal}-month goal` : `${(goal - plan.result.runway_months).toFixed(1)} months short of the goal`}
                  </p>
                </div>
                <div className="dv-plan-body">
                  <p className="dv-plan-text">{plan.description}</p>
                  <p className="dv-plan-why">{plan.justification}</p>
                </div>
              </div>
            ) : (
              <p className="dv-placeholder">Type a twist card in the console and press Go. Gemini writes a plan for this customer, the engine checks how many months it buys, and its steps switch on below as guardrails.</p>
            )}
          </section>

          {/* guardrails: the plan, enforced */}
          <section className="dv-card dv-card-rails" aria-labelledby="c-rails">
            <h2 id="c-rails" className="dv-label">Guardrails: the plan, enforced</h2>
            {!ready ? (
              <Skeleton lines={3} />
            ) : !hasShock ? (
              <p className="dv-placeholder">Read a twist card or pick a shock. The plan&rsquo;s steps then switch on here as guardrails.</p>
            ) : (
              <>
                <ul className="dv-rails">
                  {rails.map((x) => (
                    <li key={x.id} className="dv-rail">
                      <button type="button" className={`dv-guard${x.id === nextRail && !anyGuard ? ' is-next' : x.id === nextRail ? ' is-next is-soft' : ''}`} aria-pressed={!!on[x.id]} aria-busy={pending === x.id} disabled={!!pending} onClick={() => toggleRail(x)}>
                        {pending === x.id ? <span className="dv-spin" aria-hidden="true" /> : null}
                        {x.label}
                        <span className="dv-gain">+{r.alone[x.id].toFixed(1)} mo</span>
                      </button>
                      <span className="dv-who">{x.who}{x.capped ? ' · capped at what they really spend' : ''}</span>
                      {x.how && (
                        <details className="dv-why">
                          <summary>Why this</summary>
                          <p>{x.evidence}</p>
                          <p>{x.how}</p>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="dv-agent">
                  <div className="dv-agent-head">
                    <p className="dv-agent-title">Guardian agent activity <span className="dv-who">sandbox account · every tool call is rule-checked</span></p>
                    <span className="dv-shops">
                      Shop as this customer:
                      <a className="dv-actas" href={`#/shop/fresh-basket?account=${c.id}`} target="_blank" rel="noreferrer">Fresh Basket →</a>
                      <a className="dv-actas" href={`#/shop/volt?account=${c.id}`} target="_blank" rel="noreferrer">Volt →</a>
                    </span>
                  </div>
                  {payments.length > 0 && (
                    <>
                      <p className="dv-agent-sub">Payments it reviewed</p>
                      <ol className="dv-agent-log">
                        {payments.map((p) => {
                          const st = p.status === 'held' ? 'held' : p.overspend ? 'refused' : 'applied'
                          const label = p.status === 'held' ? 'On hold' : p.overspend ? 'Overspending' : p.necessary ? 'Necessary spending' : 'Not necessary, but small'
                          return (
                            <li key={p.id} className={`is-${st}`}>
                              <span className="dv-agent-mark" aria-hidden="true">{st === 'applied' ? '✓' : st === 'held' ? '⏸' : '!'}</span>
                              <code>review_payment({p.merchant}, {money(p.amount)}{p.paypal ? ', PayPal' : ''})</code>
                              <span className="dv-agent-detail">{label}: {p.limit || p.reason}{p.overspend ? ' Paid; the customer got a heads-up.' : ''}</span>
                            </li>
                          )
                        })}
                      </ol>
                      <p className="dv-agent-sub">Guardrails it set</p>
                    </>
                  )}
                  {agentLog.length === 0 ? (
                    <p className="dv-placeholder">Click a guardrail. The agent carries it out with tools, and you&rsquo;ll see each call here.</p>
                  ) : (
                    <ol className="dv-agent-log">
                      {agentLog.map((e) => (
                        <li key={e.key} className={`is-${e.status}`}>
                          <span className="dv-agent-mark" aria-hidden="true">{e.status === 'applied' ? '✓' : '✗'}</span>
                          <code>{e.tool}({fmtArgs(e.args)})</code>
                          <span className="dv-agent-detail">
                            {e.status === 'refused' ? 'Refused: ' : ''}
                            {e.detail}
                          </span>
                          {e.source && e.source !== 'gemini' && e.source !== 'customer' ? <span className="dv-who">{e.source}</span> : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <p className="dv-rails-total">
                  Runway with these guardrails: <strong>{fmtMonths(anyGuard ? r.guarded : r.shocked)}</strong>, up from {r.shocked.label}
                </p>
                <p className="dv-src">
                  {anyGuard
                    ? 'Switched on with the customer’s OK. Rent and bills always go through.'
                    : 'Click a guardrail to switch it on. Each one is an action the bank carries out, with the customer’s OK.'}
                </p>
              </>
            )}
          </section>
        </div>
      </main>

      {/* the console */}
      <form className={`dv-console${r ? ' is-live' : ''}`} onSubmit={go} noValidate>
        <div className="dv-row">
          <label className="dv-field dv-field-acct">
            <span>Account</span>
            <input
              inputMode="numeric"
              placeholder="20134"
              value={acct}
              autoFocus={!initialAccount}
              onChange={(e) => {
                setAcct(e.target.value.replace(/\D/g, '').slice(0, 5))
                setError('')
              }}
            />
          </label>
          <label className="dv-field dv-field-twist">
            <span>Twist card</span>
            <input
              placeholder="e.g. Laid off, EI pays 55% for 6 months, and bills go up 15%"
              value={twist}
              onChange={(e) => setTwist(e.target.value)}
            />
          </label>
          <button type="submit" className="dv-go" disabled={!!busy}>
            {busy ? <span className="dv-spin" aria-hidden="true" /> : null}
            {busy || 'Go'}
          </button>
        </div>

        {error && <p className="dv-error" role="alert">{error}</p>}

      </form>
    </div>
  )
}
