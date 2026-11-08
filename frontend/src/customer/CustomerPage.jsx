import { useCallback, useEffect, useRef, useState } from 'react'
import { money } from '../runway'
import './customer.css'

// Act as the customer: a sandbox card, a few made-up shops, and the messages the guardrails send.
// Messages appear here for now; later they can go to a real phone by SMS.

const SHOPS = [
  { merchant: 'Pixel Palace', category: 'electronics', amount: 1800, note: 'New gaming PC' },
  { merchant: 'Sneaker Vault', category: 'fashion', amount: 260, note: 'Limited sneakers' },
  { merchant: 'Bistro Lune', category: 'restaurant', amount: 140, note: 'Dinner for two' },
  { merchant: 'Neon Arcade', category: 'entertainment', amount: 120, note: 'Arcade night' },
  { merchant: 'Corner Grocer', category: 'groceries', amount: 86, note: 'Weekly groceries' },
  { merchant: 'City Hydro', category: 'utility bill', amount: 140, note: 'Electricity bill' },
  { merchant: 'ATM', category: 'cash', amount: 500, note: 'Cash withdrawal' },
  { merchant: 'StreamMax', category: 'subscription', amount: 25, note: 'Streaming' },
]

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export default function CustomerPage({ account }) {
  const id = Number(account)
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [codes, setCodes] = useState({})
  const [custom, setCustom] = useState({ merchant: '', amount: '' })
  const threadRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      setState(await api(`/api/customer/${id}`))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [id])

  // poll so limits the agent sets on the engine page show up here
  useEffect(() => {
    if (!id) return
    const first = setTimeout(refresh, 0)
    const t = setInterval(refresh, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [id, refresh])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [state?.messages?.length])

  async function buy(p) {
    if (busy) return
    setBusy(p.merchant)
    try {
      const d = await api('/api/customer/purchase', { account_id: id, merchant: p.merchant, category: p.category, amount: Number(p.amount) })
      setState(d.state)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function resolve(holdId, approve) {
    const d = await api('/api/customer/resolve', { account_id: id, hold_id: holdId, approve, code: codes[holdId] || '' })
    setState(d.state)
  }

  if (!id) return <div className="cu"><p className="cu-empty">Open this page from the engine with an account, e.g. #/customer?account=20111.</p></div>

  const heldIds = new Set((state?.holds || []).map((h) => h.id))

  return (
    <div className="cu">
      <header className="cu-bar">
        <a className="cu-mark" href="#/">Guardrails</a>
        <span className="cu-tag">Acting as customer {id} · sandbox, no real money</span>
        <a className="cu-back" href={`#/engine?account=${id}`}>Back to the engine</a>
      </header>

      <main className="cu-main">
        {/* the bank app */}
        <section className="cu-app" aria-label="Banking app">
          <div className="cu-card">
            <p className="cu-card-label">Chequing ·· {String(id).slice(-4)}</p>
            <p className="cu-balance">{state ? money(state.balance) : '—'}</p>
            <p className="cu-card-sub">
              {state?.runway != null ? `About ${state.runway >= 120 ? '120+' : state.runway.toFixed(1)} months of runway` : 'Loading…'}
            </p>
          </div>

          <div className="cu-limits">
            <h2>Guardrails on this account</h2>
            {state?.limits?.length ? (
              <ul>{state.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            ) : (
              <p className="cu-muted">None yet. Switch some on in the engine and they appear here.</p>
            )}
          </div>

          <h2 className="cu-h2">Spend somewhere</h2>
          <div className="cu-shops">
            {SHOPS.map((p) => (
              <button key={p.merchant} type="button" className="cu-shop" disabled={!!busy} onClick={() => buy(p)}>
                <span className="cu-shop-name">{p.merchant}</span>
                <span className="cu-shop-note">{p.note}</span>
                <span className="cu-shop-amt">{busy === p.merchant ? 'Paying…' : money(p.amount)}</span>
              </button>
            ))}
          </div>
          <form
            className="cu-custom"
            onSubmit={(e) => {
              e.preventDefault()
              if (custom.merchant && Number(custom.amount) > 0) buy({ merchant: custom.merchant, category: custom.merchant, amount: custom.amount })
            }}
          >
            <input aria-label="Where" placeholder="Anywhere, e.g. Casino Royale" value={custom.merchant} onChange={(e) => setCustom((c) => ({ ...c, merchant: e.target.value }))} />
            <input aria-label="Amount" inputMode="decimal" placeholder="$" value={custom.amount} onChange={(e) => setCustom((c) => ({ ...c, amount: e.target.value.replace(/[^\d.]/g, '') }))} />
            <button type="submit" disabled={!!busy}>Pay</button>
          </form>

          {state?.purchases?.length ? (
            <div className="cu-history">
              <h2 className="cu-h2">Recent</h2>
              <ul>
                {[...state.purchases].reverse().map((p) => (
                  <li key={p.id}>
                    <span>{p.merchant}</span>
                    <span className={`cu-status s-${p.status.split(' ')[0]}`}>{p.status}</span>
                    <span className="cu-amt">−{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error && <p className="cu-error">{error}</p>}
          <button type="button" className="cu-reset" onClick={async () => setState(await api(`/api/customer/${id}/reset`, {}))}>
            Reset the sandbox
          </button>
        </section>

        {/* the phone messages */}
        <section className="cu-phone" aria-label="Messages">
          <div className="cu-phone-head">
            <span className="cu-dot" aria-hidden="true" />
            <div>
              <p className="cu-phone-name">Guardrails</p>
              <p className="cu-muted">Text messages · shown here for now</p>
            </div>
          </div>
          <div className="cu-thread" ref={threadRef} aria-live="polite">
            {!state?.messages?.length && <p className="cu-muted cu-thread-empty">Messages from your guardrails show up here.</p>}
            {state?.messages?.map((m) => (
              <div key={m.id} className={`cu-msg k-${m.kind}`}>
                <p>{m.text}</p>
                {m.kind === 'hold' && m.why && <p className="cu-why">Why: {m.why}</p>}
                {m.kind === 'code' && heldIds.has(m.hold_id) && (
                  <div className="cu-reply">
                    <input
                      aria-label="Approval code"
                      inputMode="numeric"
                      placeholder="Code"
                      maxLength={4}
                      value={codes[m.hold_id] || ''}
                      onChange={(e) => setCodes((c) => ({ ...c, [m.hold_id]: e.target.value.replace(/\D/g, '') }))}
                    />
                    <button type="button" onClick={() => resolve(m.hold_id, true)}>Approve</button>
                    <button type="button" className="ghost" onClick={() => resolve(m.hold_id, false)}>Cancel it</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
