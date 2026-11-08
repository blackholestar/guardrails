// Thin client for the FastAPI backend. All calculations happen server-side.

async function getJson(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // keep default message
    }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return res.json()
}

export const fetchGlossary = () => getJson('/api/glossary')

export const fetchExamples = () => getJson('/api/accounts?limit=3')

// Typed scenario -> AI-chosen impact variables and plan, scored by the engine.
export const planScenario = (accountId, scenario) => getJson('/api/ai/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account_id: Number(accountId), scenario }),
})

// Follow-up about a plan. history: [{role: 'user' | 'model', text}], starting with the scenario; model turns are the
// `model_turn` values earlier responses returned. Reply has `reply` and `revised` (a scored plan, or null).
export const followUp = (accountId, history, message) => getJson('/api/ai/followup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account_id: Number(accountId), history, message }),
})

// shock: optional object with income_multiplier, income_months, bills_pct, one_off_cost, extra_monthly
export function fetchAccount(accountId, shock = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(shock)) {
    if (v !== null && v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return getJson(`/api/accounts/${encodeURIComponent(accountId)}${qs ? `?${qs}` : ''}`)
}
