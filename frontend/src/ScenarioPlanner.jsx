import { useState } from 'react'
import { planScenario } from './api'

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
}

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
    <table className="var-table">
      <tbody>
        {Object.keys(VAR_LABELS).map((k) => (
          <tr key={k}>
            <th scope="row">{VAR_LABELS[k]}</th>
            <td>{formatVar(k, variables[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Outcome({ title, result }) {
  return (
    <div className="metric">
      <div className="metric-label">{title}</div>
      <div className="metric-value">{runwayText(result)}</div>
      <div className="outcome-detail">
        Buffer left {money(result.buffer_left)} · monthly gap {money(result.gap)}
      </div>
    </div>
  )
}

const CARD_ORDER = ['I', 'F', 'S', 'B', 'H', 'P', 'gap', 'runway']

const signed = (d, fmt) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))}`
const same = (d) => Math.abs(d) < 0.005

function ChangeCard({ info, change }) {
  const isRunway = info && change.before_label !== undefined
  const fmt = isRunway ? (v) => `${v.toFixed(1)} months` : money
  const label = (v, l) => (isRunway && typeof l === 'string' ? l : fmt(v))
  const unchanged = same(change.delta)
  return (
    <div className="metric">
      <div className="metric-label">
        {info.label}
        {info.help && (
          <span className="tip" tabIndex={0} aria-label={info.help}>
            ?<span className="tip-text" role="tooltip">{info.help}</span>
          </span>
        )}
      </div>
      <div className="metric-value change-value">
        {!unchanged && <s className="old-value">{label(change.before, change.before_label)}</s>}
        <span>{label(change.after, change.after_label)}</span>
      </div>
      <div className="change-delta">{unchanged ? 'no change' : signed(change.delta, fmt)}</div>
    </div>
  )
}

export default function ScenarioPlanner({ accountId, metrics }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    const scenario = text.trim()
    if (!scenario || loading || accountId == null) return
    setLoading(true)
    setError(null)
    try {
      setResult(await planScenario(accountId, scenario))
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
        <form onSubmit={onSubmit} className="planner-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. I became unemployed and only get 55% EI benefits"
            aria-label="Describe your scenario"
          />
          <div className="planner-actions">
            <button type="submit" disabled={loading || !text.trim()}>
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

      {error && <div className="banner error">{error}</div>}

      {result && (
        <div className="planner-result">
          <h3>What changes</h3>
          <p>{result.impact_summary}</p>
          <VarTable variables={result.impact.variables} />

          <h3>The plan</h3>
          <p>{result.plan.description}</p>
          <p className="justification"><strong>Why:</strong> {result.plan.justification}</p>
          <VarTable variables={result.plan.variables} />

          <h3>Runway</h3>
          <div className="grid">
            <Outcome title="Before" result={result.baseline} />
            <Outcome title="After the event" result={result.impact.result} />
            <Outcome title="With the plan" result={result.plan.result} />
          </div>
          {metrics && (
            <>
              <h3>Your numbers with the plan</h3>
              <div className="grid">
                {CARD_ORDER.filter((k) => metrics[k] && result.plan.metrics[k]).map((k) => (
                  <ChangeCard key={k} info={metrics[k]} change={result.plan.metrics[k]} />
                ))}
              </div>
            </>
          )}
          <p className="caption">Generated by {result.model}. This is an estimate, not financial advice.</p>

          <details>
            <summary>Raw output (JSON)</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  )
}
