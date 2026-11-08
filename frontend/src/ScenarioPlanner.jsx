import { useState } from 'react'
import { followUp, planScenario } from './api'

const EXAMPLES = [
  'I lost my job and only receive 55% of my income in EI benefits for 6 months.',
  'My car broke down and cost $3500 to fix.',
  'My rent and utility bills went up 15%.',
]

const VAR_LABELS = {
  income_multiplier: 'Income received (share of normal)',
  income_months: 'Income change lasts (months)',
  bills_pct: 'Change in household bills',
  one_off_cost: 'One-time cost',
  extra_monthly: 'Added monthly spending',
  extra_income: 'Added monthly income',
}

const CATEGORY_LABELS = {
  cash_withdrawals: 'Cash withdrawals',
  card_spending: 'Card spending',
  transfers_out: 'Transfers out',
  bank_fees: 'Bank fees',
  household_bills: 'Household bills',
  insurance: 'Insurance',
  loan_payment: 'Loan payment',
  income: 'Income',
}

const CHIP_LABELS = { I: 'Income', S: 'Spending', F: 'Fixed costs', H: 'Household bills', P: 'Loan payment' }
const CHIP_ORDER = Object.keys(CHIP_LABELS)

const money = (x) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(x)

function formatVar(key, v) {
  if (v === null || v === undefined) return 'not set'
  if (key === 'income_multiplier') return `${Math.round(v * 100)}%`
  if (key === 'bills_pct') return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
  if (key === 'income_months') return `${v}`
  return money(v)
}

const runwayText = (r) =>
  typeof r.runway_label === 'string' ? r.runway_label : `${r.runway_label.toFixed(1)} months`

function VarTable({ variables }) {
  return (
    <table className="tbl var-table">
      <tbody>
        {Object.keys(VAR_LABELS).filter((k) => k in variables).map((k) => (
          <tr key={k}>
            <th scope="row">{VAR_LABELS[k]}</th>
            <td className="r num strong">{formatVar(k, variables[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Outcome({ title, result }) {
  return (
    <div className="card metric">
      <div className="metric-label">{title}</div>
      <div className="metric-value num">{runwayText(result)}</div>
      <div className="outcome-detail">
        Buffer left {money(result.buffer_left)} · monthly gap {money(result.gap)}
      </div>
      {result.makes_it !== undefined && (
        <div className={`change-delta${result.makes_it ? ' up' : ' down'}`}>
          {result.makes_it ? 'Lasts the whole event' : 'Runs out before the event ends'}
        </div>
      )}
    </div>
  )
}

const CARD_ORDER = ['I', 'F', 'S', 'B', 'H', 'P', 'gap', 'runway']

const signed = (d, fmt) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))}`
const same = (d) => Math.abs(d) < 0.005

// invert: a decrease is good (green) and an increase is bad (red), e.g. the monthly gap.
function ChangeCard({ info, change, invert = false }) {
  const isRunway = info && change.before_label !== undefined
  const fmt = isRunway ? (v) => `${v.toFixed(1)} months` : money
  const label = (v, l) => (isRunway && typeof l === 'string' ? l : fmt(v))
  const unchanged = same(change.delta)
  return (
    <div className="card metric">
      <div className="metric-label">
        {info.label}
        {info.help && (
          <span className="tip" tabIndex={0} aria-label={info.help}>
            ?<span className="tip-text" role="tooltip">{info.help}</span>
          </span>
        )}
      </div>
      <div className="metric-value num change-value">
        {!unchanged && <s className="old-value">{label(change.before, change.before_label)}</s>}
        <span>{label(change.after, change.after_label)}</span>
      </div>
      <div className={`change-delta num${unchanged ? '' : (change.delta > 0) !== invert ? ' up' : ' down'}`}>{unchanged ? 'no change' : signed(change.delta, fmt)}</div>
    </div>
  )
}

// One chip per metric an action moves, e.g. "Spending −$400". Green when the change helps.
function MetricChips({ changes }) {
  const keys = CHIP_ORDER.filter((k) => changes[k] !== undefined && !same(changes[k]))
  if (!keys.length) return null
  return (
    <div className="chips">
      {keys.map((k) => (
        <span key={k} className={`chip num ${(changes[k] > 0) === (k === 'I') ? 'up' : 'down'}`}>
          {CHIP_LABELS[k]} ({k}) {signed(changes[k], money)}
        </span>
      ))}
    </div>
  )
}

function ActionList({ actions }) {
  return (
    <ol className="action-list">
      {actions.map((a, i) => (
        <li key={i} className={`card action-card${a.status === 'dropped' ? ' dropped' : ''}`}>
          <div className="action-head">
            <span className="action-title">{a.title}</span>
            <span className="action-amount num">
              {a.status === 'dropped' ? 'not counted' : a.status === 'advice' ? 'advice' : `${money(a.monthly_amount)}/month`}
            </span>
          </div>
          <div className="action-meta">
            {CATEGORY_LABELS[a.category] ?? a.category} · {a.difficulty}
            {a.ref && <> · {a.ref}</>}
          </div>
          <MetricChips changes={a.metric_changes} />
          <p className="action-how">{a.how}</p>
          <p className="action-evidence"><strong>Based on your data:</strong> {a.evidence}</p>
          {a.note && <p className="action-note">{a.note}</p>}
        </li>
      ))}
    </ol>
  )
}

function ChangeCards({ metrics, changes }) {
  return (
    <div className="metrics">
      {CARD_ORDER.filter((k) => metrics[k] && changes[k]).map((k) => (
        <ChangeCard key={k} info={metrics[k]} change={changes[k]} invert={k === 'gap'} />
      ))}
    </div>
  )
}

// Plain text with paragraphs and "- " list lines, without rendering any HTML from the model.
function ReplyText({ text }) {
  const blocks = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) { blocks.push(null); continue }
    const item = /^[-*•]\s+/.test(t) ? t.replace(/^[-*•]\s+/, '') : null
    const last = blocks[blocks.length - 1]
    if (item !== null) {
      if (Array.isArray(last)) last.push(item)
      else blocks.push([item])
    } else if (typeof last === 'string') blocks[blocks.length - 1] = `${last} ${t}`
    else blocks.push(t)
  }
  return blocks.filter((b) => b !== null).map((b, i) =>
    Array.isArray(b) ? <ul key={i}>{b.map((x, j) => <li key={j}>{x}</li>)}</ul> : <p key={i}>{b}</p>)
}

function RevisedPlan({ revised, metrics, number }) {
  return (
    <div className="revised">
      <div className="revised-head">Revised plan {number}</div>
      <p className="revised-change">{revised.change_summary}</p>
      {revised.assumptions?.length > 0 && (
        <div className="assumptions">
          <strong>Assumptions</strong>
          <ul>{revised.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {revised.plan.actions.length > 0
        ? <ActionList actions={revised.plan.actions} />
        : <p className="hint">This plan has no spending or income changes.</p>}
      <div className="metrics metrics-3">
        <Outcome title="After the event" result={revised.impact.result} />
        <Outcome title="Previous plan" result={revised.previous.plan} />
        <Outcome title="Revised plan" result={revised.plan.result} />
      </div>
      {metrics && (
        <>
          <h3>Your numbers with the revised plan</h3>
          <ChangeCards metrics={metrics} changes={revised.plan.metrics} />
        </>
      )}
    </div>
  )
}

const FOLLOW_UP_EXAMPLES = [
  'Why is my runway so short?',
  "I can't cut that much cash. What else can I do?",
  'What if it lasts 3 months longer?',
]

function Conversation({ accountId, scenario, first, metrics }) {
  // history is what the API needs; thread is what the page shows.
  const [history, setHistory] = useState([{ role: 'user', text: scenario }, { role: 'model', text: first.model_turn }])
  const [thread, setThread] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const revisions = thread.filter((t) => t.revised).length

  async function onSend(e) {
    e.preventDefault()
    const message = text.trim()
    if (!message || loading) return
    setLoading(true)
    setError(null)
    setThread((t) => [...t, { role: 'user', text: message }])
    setText('')
    try {
      const r = await followUp(accountId, history, message)
      setHistory((h) => [...h, { role: 'user', text: message }, { role: 'model', text: r.model_turn }])
      setThread((t) => [...t, { role: 'ai', reply: r.reply, revised: r.revised }])
    } catch (err) {
      setThread((t) => t.slice(0, -1))  // drop the unanswered message so it can be sent again
      setText(message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  let shown = 0
  return (
    <div className="conversation">
      <h3>Ask about the plan</h3>
      <p className="caption">
        Ask a question, push back on a step, or change the situation. If the AI changes the plan, the app checks the
        new steps and recalculates your numbers.
      </p>
      {thread.map((t, i) => t.role === 'user' ? (
        <div key={i} className="msg msg-user">{t.text}</div>
      ) : (
        <div key={i} className="msg msg-ai card">
          <ReplyText text={t.reply} />
          {t.revised && <RevisedPlan revised={t.revised} metrics={metrics} number={++shown} />}
        </div>
      ))}
      {loading && <div className="msg msg-ai card hint">Thinking…</div>}
      {error && <div className="ds-error" role="alert">{error}</div>}
      <form onSubmit={onSend} className="card planner-form">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) onSend(e) }}
          maxLength={2000}
          rows={2}
          placeholder={revisions ? 'Ask about the revised plan…' : 'e.g. Why that step? Or: I can only cut $300 of cash.'}
          aria-label="Follow-up message"
        />
        <div className="planner-actions">
          <button className="btn-primary" type="submit" disabled={loading || !text.trim()}>
            {loading ? 'Sending…' : 'Send'}
          </button>
          {thread.length === 0 && (
            <>
              <span className="hint">Try:</span>
              {FOLLOW_UP_EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="link" onClick={() => setText(ex)}>{ex}</button>
              ))}
            </>
          )}
        </div>
      </form>
    </div>
  )
}

export default function ScenarioPlanner({ accountId, metrics }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [runId, setRunId] = useState(0)  // remounts the conversation for each new plan

  async function onSubmit(e) {
    e.preventDefault()
    const scenario = text.trim()
    if (!scenario || loading || accountId == null) return
    setLoading(true)
    setError(null)
    try {
      setResult(await planScenario(accountId, scenario))
      setRunId((n) => n + 1)
    } catch (err) {
      setResult(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="planner">
      <h2>What if…?</h2>
      <p className="caption">
        Describe something that changes your finances. The AI picks what it affects and suggests a plan; the numbers
        are calculated by the app, not the AI.
      </p>

      {accountId == null ? (
        <p className="hint">Look up an account above to try a scenario.</p>
      ) : (
        <form onSubmit={onSubmit} className="card planner-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. I became unemployed and only get 55% EI benefits"
            aria-label="Describe your scenario"
          />
          <div className="planner-actions">
            <button className="btn-primary" type="submit" disabled={loading || !text.trim()}>
              {loading ? 'Planning…' : 'Make a plan'}
            </button>
            <span className="hint">Try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="link" onClick={() => setText(ex)}>
                {ex.length > 36 ? `${ex.slice(0, 34)}…` : ex}
              </button>
            ))}
          </div>
        </form>
      )}

      {error && <div className="ds-error" role="alert">{error}</div>}

      {result && (
        <div className="planner-result">
          <h3>What changes</h3>
          <div className="card text-card">
            <p>{result.impact_summary}</p>
            {result.assumptions?.length > 0 && (
              <div className="assumptions">
                <strong>Assumptions</strong>
                <ul>{result.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            <VarTable variables={result.impact.variables} />
          </div>
          {metrics && result.impact.metrics && (
            <>
              <h3>Your numbers after the event</h3>
              <ChangeCards metrics={metrics} changes={result.impact.metrics} />
            </>
          )}

          <hr className="planner-divide" />

          <h3>The plan</h3>
          <div className="card text-card">
            <p>{result.plan.summary ?? result.plan.description}</p>
            <p className="justification"><strong>Why:</strong> {result.plan.justification}</p>
          </div>

          {result.plan.actions?.length > 0 ? (
            <>
              <h3>Steps</h3>
              <ActionList actions={result.plan.actions} />
              <p className="caption">
                The AI suggests each step and its amount. The app checks every amount against your records and
                calculates the changes shown.
              </p>
            </>
          ) : (
            <p className="hint">No spending or income changes are needed for this event.</p>
          )}

          {result.plan.risks?.length > 0 && (
            <>
              <h3>Watch out for</h3>
              <ul className="card text-card risks">{result.plan.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}

          <details className="raw">
            <summary>Plan variables used by the calculator</summary>
            <VarTable variables={result.plan.variables} />
          </details>

          <h3>Runway</h3>
          <div className="metrics metrics-3">
            <Outcome title="Before" result={result.baseline} />
            <Outcome title="After the event" result={result.impact.result} />
            <Outcome title="With the plan" result={result.plan.result} />
          </div>
          {metrics && (
            <>
              <h3>Your numbers with the plan</h3>
              <ChangeCards metrics={metrics} changes={result.plan.metrics} />
            </>
          )}
          <p className="caption">Generated by {result.model}. This is an estimate, not financial advice.</p>

          {result.model_turn && (
            <Conversation key={runId} accountId={accountId} scenario={result.scenario} first={result} metrics={metrics} />
          )}

          {result.context_summary && (
            <details className="raw">
              <summary>Account data the AI saw</summary>
              <pre>{result.context_summary}</pre>
            </details>
          )}
          <details className="raw">
            <summary>Raw output (JSON)</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  )
}
