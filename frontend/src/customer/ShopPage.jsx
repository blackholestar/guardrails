import { useState } from 'react'
import { money } from '../runway'
import { PayPalButtons } from './PayPalButtons'
import { Phone } from './Phone'
import { customerApi, useCustomer } from './customerApi'
import './customer.css'
import './shop.css'

// Two made-up stores in the familiar style of online shops, to show the agent telling necessities
// from discretionary spending. Both pay with the customer's sandbox card.

const STORES = {
  'fresh-basket': {
    key: 'fresh-basket',
    name: 'Fresh Basket',
    tagline: 'Groceries delivered',
    category: 'groceries',
    theme: 'fresh',
    sections: ['Produce', 'Dairy & eggs', 'Pantry', 'Household'],
    products: [
      { name: 'Bananas, bunch', price: 2.49, section: 'Produce', icon: '🍌' },
      { name: 'Apples, 3 lb bag', price: 5.99, section: 'Produce', icon: '🍎' },
      { name: 'Broccoli', price: 3.29, section: 'Produce', icon: '🥦' },
      { name: 'Milk 2%, 4 L', price: 6.49, section: 'Dairy & eggs', icon: '🥛' },
      { name: 'Large eggs, dozen', price: 4.79, section: 'Dairy & eggs', icon: '🥚' },
      { name: 'Cheddar, 400 g', price: 7.99, section: 'Dairy & eggs', icon: '🧀' },
      { name: 'Whole wheat bread', price: 3.99, section: 'Pantry', icon: '🍞' },
      { name: 'Rice, 2 kg', price: 6.99, section: 'Pantry', icon: '🍚' },
      { name: 'Chicken breasts, 1 kg', price: 14.99, section: 'Pantry', icon: '🍗' },
      { name: 'Diapers, size 3', price: 27.99, section: 'Household', icon: '🧷' },
      { name: 'Laundry detergent', price: 12.49, section: 'Household', icon: '🧴' },
      { name: 'Toilet paper, 12 rolls', price: 9.99, section: 'Household', icon: '🧻' },
    ],
  },
  volt: {
    key: 'volt',
    name: 'Volt',
    tagline: 'Electronics & gaming',
    category: 'electronics',
    theme: 'volt',
    sections: ['Deals', 'Gaming', 'Audio', 'TV & home'],
    products: [
      { name: 'Noise-cancelling headphones', price: 349.99, section: 'Audio', icon: '🎧', was: 449.99 },
      { name: 'Wireless earbuds', price: 179.99, section: 'Audio', icon: '🎶' },
      { name: 'Gaming console, 1 TB', price: 649.99, section: 'Gaming', icon: '🎮' },
      { name: 'Gaming PC, RTX edition', price: 1799.99, section: 'Gaming', icon: '🖥️', was: 2099.99 },
      { name: 'Mechanical keyboard', price: 159.99, section: 'Gaming', icon: '⌨️' },
      { name: '65" 4K smart TV', price: 1199.99, section: 'TV & home', icon: '📺', was: 1499.99 },
      { name: 'Soundbar', price: 299.99, section: 'TV & home', icon: '🔊' },
      { name: 'Smartwatch', price: 429.99, section: 'Deals', icon: '⌚', was: 529.99 },
    ],
  },
}

export default function ShopPage({ store: storeKey, account }) {
  const store = STORES[storeKey]
  const id = Number(account)
  const { state, setState } = useCustomer(id)
  const [cart, setCart] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  if (!store) return <div className="cu"><p className="cu-empty">Unknown store.</p></div>
  if (!id) return <div className="cu"><p className="cu-empty">Open this from the customer page, e.g. #/shop/volt?account=20111.</p></div>

  const items = Object.entries(cart).filter(([, q]) => q > 0)
  const total = items.reduce((t, [name, q]) => t + q * store.products.find((p) => p.name === name).price, 0)
  const add = (name, d = 1) => setCart((c) => ({ ...c, [name]: Math.max((c[name] || 0) + d, 0) }))

  async function checkout() {
    if (!total || busy) return
    setBusy(true)
    try {
      const d = await customerApi('/api/customer/purchase', {
        account_id: id,
        merchant: store.name,
        category: `${store.category}: ${items.map(([n, q]) => `${q}× ${n}`).join(', ')}`.slice(0, 60),
        amount: Math.round(total * 100) / 100,
      })
      setState(d.state)
      setResult(d.status)
      if (d.status === 'approved') setCart({})
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`sh sh-${store.theme}`}>
      <div className="sh-demo">
        Demo store to illustrate the agent · paying as customer {id} with the sandbox card ·{' '}
        <a href={`#/shop/${storeKey === 'volt' ? 'fresh-basket' : 'volt'}?account=${id}`}>
          Go to {storeKey === 'volt' ? 'Fresh Basket' : 'Volt'}
        </a>
      </div>
      <header className="sh-head">
        <p className="sh-logo">{store.name}</p>
        <div className="sh-search" aria-hidden="true">Search {store.tagline.toLowerCase()}…</div>
        <p className="sh-cart-pill">Cart · {money(total)}</p>
      </header>
      <nav className="sh-nav" aria-label="Departments">
        {store.sections.map((s) => <span key={s}>{s}</span>)}
      </nav>

      <main className="sh-main">
        <div className="sh-grid">
          {store.products.map((p) => (
            <article key={p.name} className="sh-item">
              <div className="sh-img" aria-hidden="true">{p.icon}</div>
              <p className="sh-name">{p.name}</p>
              <p className="sh-price">
                {money2(p.price)}
                {p.was ? <s>{money2(p.was)}</s> : null}
              </p>
              {cart[p.name] ? (
                <div className="sh-qty">
                  <button type="button" onClick={() => add(p.name, -1)} aria-label={`Remove one ${p.name}`}>−</button>
                  <span>{cart[p.name]}</span>
                  <button type="button" onClick={() => add(p.name)} aria-label={`Add one ${p.name}`}>+</button>
                </div>
              ) : (
                <button type="button" className="sh-add" onClick={() => add(p.name)}>Add to cart</button>
              )}
            </article>
          ))}
        </div>

        <aside className="sh-side">
          <div className="sh-cart">
            <h2>Your cart</h2>
            {items.length === 0 ? (
              <p className="cu-muted">Empty. Add something.</p>
            ) : (
              <ul>
                {items.map(([n, q]) => (
                  <li key={n}><span>{q}× {n}</span><span>{money2(q * store.products.find((p) => p.name === n).price)}</span></li>
                ))}
              </ul>
            )}
            <p className="sh-total"><span>Total</span><span>{money2(total)}</span></p>
            <button type="button" className="sh-checkout" disabled={!total || busy} onClick={checkout}>
              {busy ? 'Paying…' : 'Checkout with card'}
            </button>
            {total > 0 && (
              <>
                <p className="sh-or">or</p>
                <PayPalButtons
                  id={id}
                  store={store}
                  items={items.map(([name, qty]) => ({ name, qty, price: store.products.find((p) => p.name === name).price }))}
                  onDone={(d) => {
                    setState(d.state)
                    setResult(d.status)
                    if (d.status === 'approved') setCart({})
                  }}
                />
              </>
            )}
            {result === 'approved' && <p className="sh-note ok">Paid. Thanks for shopping.</p>}
            {result === 'held' && <p className="sh-note hold">Payment on hold. Check your phone.</p>}
            <p className="cu-muted sh-bal">Card balance: {state ? money(state.balance) : '—'}</p>
          </div>
          <Phone id={id} state={state} setState={setState} compact />
        </aside>
      </main>
    </div>
  )
}

const money2 = (x) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(x)
