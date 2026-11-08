import { useEffect, useRef, useState } from 'react'
import { customerApi } from './customerApi'

// PayPal sandbox checkout. The order is created and read on our backend, so it sees PayPal's own record
// of the payee and items; the backend decides whether to capture now or hold for the shopper's code.

let sdk = null
function loadSdk(clientId) {
  if (!sdk) {
    sdk = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=CAD&intent=capture&components=buttons`
      s.onload = () => resolve(window.paypal)
      s.onerror = () => {
        sdk = null
        reject(new Error('PayPal failed to load'))
      }
      document.head.appendChild(s)
    })
  }
  return sdk
}

export function PayPalButtons({ id, store, items, onDone }) {
  const box = useRef(null)
  const latest = useRef({ items, onDone })
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    latest.current = { items, onDone }
  })

  useEffect(() => {
    let buttons
    let gone = false
    customerApi('/api/paypal/config')
      .then((cfg) => {
        if (!cfg.enabled) throw new Error('off')
        return loadSdk(cfg.client_id)
      })
      .then((paypal) => {
        if (gone || !box.current) return
        buttons = paypal.Buttons({
          style: { layout: 'horizontal', tagline: false, height: 44 },
          createOrder: async () => {
            const d = await customerApi('/api/paypal/order', {
              account_id: id,
              store: store.key,
              store_name: store.name,
              items: latest.current.items,
            })
            return d.id
          },
          onApprove: async ({ orderID }) => {
            const d = await customerApi('/api/paypal/approved', {
              account_id: id,
              order_id: orderID,
              store_name: store.name,
              category: store.category,
            })
            latest.current.onDone(d)
          },
          onError: () => setStatus('error'),
        })
        buttons.render(box.current)
        setStatus('ready')
      })
      .catch((e) => !gone && setStatus(e.message === 'off' ? 'off' : 'error'))
    return () => {
      gone = true
      buttons?.close?.()
    }
  }, [id, store])

  if (status === 'off') return <p className="cu-muted sh-pp-note">PayPal isn't set up on the server.</p>
  return (
    <div className="sh-pp">
      <div ref={box} />
      {status === 'loading' && <p className="cu-muted sh-pp-note">Loading PayPal…</p>}
      {status === 'error' && <p className="cu-muted sh-pp-note">PayPal had a problem. Try again or use the card.</p>}
    </div>
  )
}
