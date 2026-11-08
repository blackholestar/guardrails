import { useCallback, useEffect, useState } from 'react'

// Sandbox state for the customer page and the shops, polled so limits set on the engine page show up.

export async function customerApi(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export function useCustomer(id) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      setState(await customerApi(`/api/customer/${id}`))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [id])
  useEffect(() => {
    if (!id) return
    const first = setTimeout(refresh, 0)
    const t = setInterval(refresh, 2500)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [id, refresh])
  return { state, setState, error, refresh }
}
