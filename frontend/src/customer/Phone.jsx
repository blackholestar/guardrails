import { useEffect, useRef, useState } from 'react'
import { customerApi } from './customerApi'

// The phone that shows the guardrails' messages (a stand-in for SMS). Used by the customer page and the shops.

export function Phone({ id, state, setState, compact = false }) {
  const [codes, setCodes] = useState({})
  const threadRef = useRef(null)
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [state?.messages?.length])

  async function resolve(holdId, approve) {
    const d = await customerApi('/api/customer/resolve', { account_id: id, hold_id: holdId, approve, code: codes[holdId] || '' })
    setState(d.state)
  }
  const heldIds = new Set((state?.holds || []).map((h) => h.id))
  const messages = compact ? (state?.messages || []).slice(-6) : state?.messages || []

  return (
    <section className={`cu-phone${compact ? ' is-compact' : ''}`} aria-label="Messages">
      <div className="cu-phone-head">
        <span className="cu-dot" aria-hidden="true" />
        <div>
          <p className="cu-phone-name">Guardrails</p>
          <p className="cu-muted">Text messages · shown here for now</p>
        </div>
      </div>
      <div className="cu-thread" ref={threadRef} aria-live="polite">
        {!messages.length && <p className="cu-muted cu-thread-empty">Messages from your guardrails show up here.</p>}
        {messages.map((m) => (
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
  )
}
