import { useEffect, useState } from 'react'
import { fetchAccount, fetchExamples, fetchGlossary } from './api'
import ScenarioPlanner from './ScenarioPlanner'
import './App.css'

const money = (x) =>
  x === null || x === undefined
    ? 'n/a'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(x)

const runwayText = (block) =>
  typeof block.runway_label === 'string' ? block.runway_label : `${block.runway_label.toFixed(1)} months`

function Metric({ label, value, help }) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {help && (
          <span className="tip" tabIndex={0} aria-label={help}>
            ?<span className="tip-text" role="tooltip">{help}</span>
          </span>
        )}
      </div>
      <div className="metric-value">{value}</div>
    </div>
  )
}

export default function App() {
  const [glossary, setGlossary] = useState(null)
  const [examples, setExamples] = useState(null)
  const [input, setInput] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    Promise.all([fetchGlossary(), fetchExamples()])
      .then(([g, e]) => {
        setGlossary(g)
        setExamples(e)
      })
      .catch(() => setError('Cannot reach the backend. Start it with: uvicorn src.api:app --port 8000'))
  }, [])

  async function lookup(id) {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchAccount(id))
    } catch (e) {
      setData(null)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    const id = input.trim()
    if (!/^\d+$/.test(id)) {
      setData(null)
      setError('Enter a numeric account ID.')
      return
    }
    lookup(id)
  }

  const m = glossary?.metrics
  const p = data?.profile
  const base = data?.baseline

  return (
    <main className="app">
      <h1>Resilience Rewired</h1>
      <p className="caption">Tangerine track, Sheridan Datathon 2026</p>

      <form onSubmit={onSubmit} className="lookup">
        <label htmlFor="account-id">Account ID</label>
        <input
          id="account-id"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 20134"
        />
        <button type="submit" disabled={loading || !glossary}>
          {loading ? 'Loading…' : 'Look up'}
        </button>
      </form>

      {!data && !error && examples && (
        <p className="hint">
          Enter an account ID. {examples.count.toLocaleString()} accounts available, e.g.{' '}
          {examples.examples.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <button type="button" className="link" onClick={() => { setInput(String(id)); lookup(id) }}>
                {id}
              </button>
            </span>
          ))}
          .
        </p>
      )}

      {error && <div className="banner error">{error}</div>}

      {data && m && (
        <section>
          <h2>Account {data.account_id}</h2>
          <p className="caption">
            {p.district} ({p.region}) · owner age {Math.round(p.owner_age)} · {p.months_history} months of history ·
            loan status: {p.loan_status || 'none'}
          </p>

          {data.flags.map((f) => (
            <div key={f} className="banner warn">{glossary.flags[f] ?? f}</div>
          ))}

          <div className="grid">
            <Metric {...m.I} value={money(p.I)} />
            <Metric {...m.F} value={money(p.F)} />
            <Metric {...m.S} value={money(p.S)} />
            <Metric {...m.B} value={money(p.B)} />
            <Metric {...m.H} value={money(p.H)} />
            <Metric {...m.P} value={money(p.P)} />
            <Metric {...m.gap} value={money(base.gap)} />
            <Metric {...m.runway} value={runwayText(base)} />
          </div>

          <details>
            <summary>Raw output (JSON)</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </section>
      )}

      <ScenarioPlanner key={data?.account_id ?? 'none'} accountId={data?.account_id ?? null} metrics={m} />
    </main>
  )
}
