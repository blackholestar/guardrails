import { useState } from 'react'
import { money } from '../runway'
import { PayPalButtons } from './PayPalButtons'
import { Phone } from './Phone'
import { customerApi, useCustomer } from './customerApi'
import './customer.css'
import './shop.css'

// Two made-up stores laid out like ordinary online shops (a grocer's grid, an electronics list), to show
// the agent telling necessities from discretionary spending. Both pay with the customer's sandbox card.

const STORES = {
  'fresh-basket': {
    key: 'fresh-basket',
    name: 'Fresh Basket',
    category: 'groceries',
    theme: 'fresh',
    layout: 'grid',
    search: 'Search groceries',
    sections: ['Produce', 'Dairy & eggs', 'Pantry', 'Meat', 'Household'],
    products: [
      { name: 'Bananas', size: 'bunch, about 1.2 kg', unit: '$2.08/kg', price: 2.49, section: 'Produce', pack: '#f3d34a', dark: true },
      { name: 'Gala apples', size: '3 lb bag', unit: '$4.40/kg', price: 5.99, section: 'Produce', pack: '#c8402c' },
      { name: 'Broccoli crowns', size: 'each', unit: '$3.29 ea', price: 3.29, section: 'Produce', pack: '#3f7d3a' },
      { name: 'Milk 2%', size: '4 L', unit: '$1.62/L', price: 6.49, section: 'Dairy & eggs', pack: '#2f6db5' },
      { name: 'Large eggs', size: '12 pack', unit: '$0.40 ea', price: 4.79, section: 'Dairy & eggs', pack: '#e9dcc0', dark: true },
      { name: 'Old cheddar', size: '400 g', unit: '$2.00/100 g', price: 7.99, section: 'Dairy & eggs', pack: '#e8a33a', dark: true },
      { name: 'Whole wheat bread', size: '675 g', unit: '$0.59/100 g', price: 3.99, section: 'Pantry', pack: '#9b6a3c' },
      { name: 'Long grain rice', size: '2 kg', unit: '$3.50/kg', price: 6.99, section: 'Pantry', pack: '#ece7da', dark: true },
      { name: 'Chicken breasts', size: 'about 1 kg', unit: '$14.99/kg', price: 14.99, section: 'Meat', pack: '#e7b8a8', dark: true },
      { name: 'Diapers, size 3', size: '84 count', unit: '$0.33 ea', price: 27.99, section: 'Household', pack: '#7fb7d9', dark: true },
      { name: 'Laundry detergent', size: '2.95 L', unit: '$4.23/L', price: 12.49, section: 'Household', pack: '#5b4a9e' },
      { name: 'Bathroom tissue', size: '12 double rolls', unit: '$0.83/roll', price: 9.99, section: 'Household', pack: '#efefe9', dark: true },
    ],
  },
  volt: {
    key: 'volt',
    name: 'Volt',
    category: 'electronics',
    theme: 'volt',
    layout: 'list',
    search: 'Search Volt',
    sections: ['TV & Home Theatre', 'Computers', 'Gaming', 'Headphones', 'Wearables'],
    products: [
      { name: '65" 4K UHD Smart TV, 120 Hz', sku: 'VT-65U8', price: 1199.99, was: 1499.99, section: 'TV & Home Theatre', specs: ['65" class, 4K UHD', '120 Hz refresh', '4 HDMI ports'], art: '65"' },
      { name: '3.1 Channel Soundbar with Wireless Subwoofer', sku: 'VS-310', price: 299.99, section: 'TV & Home Theatre', specs: ['3.1 channels', 'Wireless sub', 'HDMI eARC'], art: '3.1' },
      { name: 'Gaming Desktop PC, RTX 4070, 32 GB RAM', sku: 'VG-4070', price: 1799.99, was: 2099.99, section: 'Computers', specs: ['RTX 4070 12 GB', '32 GB DDR5', '1 TB SSD'], art: 'RTX' },
      { name: 'Gaming Console, 1 TB', sku: 'VC-1TB', price: 649.99, section: 'Gaming', specs: ['1 TB storage', '4K at 120 fps', 'One controller'], art: '1TB' },
      { name: 'Mechanical Keyboard, Hot-swap', sku: 'VK-87', price: 159.99, section: 'Gaming', specs: ['Tenkeyless', 'Hot-swap switches', 'USB-C'], art: '87' },
      { name: 'Wireless Noise-Cancelling Headphones', sku: 'VH-NC9', price: 349.99, was: 449.99, section: 'Headphones', specs: ['Active noise cancelling', '30 h battery', 'Bluetooth 5.3'], art: 'NC' },
      { name: 'True Wireless Earbuds', sku: 'VE-TW2', price: 179.99, section: 'Headphones', specs: ['Noise cancelling', '8 h + case', 'IPX4'], art: 'TW' },
      { name: 'Smartwatch, 45 mm, GPS', sku: 'VW-45G', price: 429.99, was: 529.99, section: 'Wearables', specs: ['45 mm case', 'GPS', '2-day battery'], art: '45' },
    ],
  },
}

const cad = (x) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(x)

export default function ShopPage({ store: storeKey, account }) {
  const store = STORES[storeKey]
  const id = Number(account)
  const { state, setState } = useCustomer(id)
  const [cart, setCart] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [query, setQuery] = useState('')
  const [dept, setDept] = useState('All')

  if (!store) return <div className="cu"><p className="cu-empty">Unknown store.</p></div>
  if (!id) return <div className="cu"><p className="cu-empty">Open this from the engine, e.g. #/shop/volt?account=20111.</p></div>

  const grid = store.layout === 'grid'
  const price = (name) => store.products.find((p) => p.name === name).price
  const items = Object.entries(cart).filter(([, q]) => q > 0)
  const count = items.reduce((n, [, q]) => n + q, 0)
  const total = items.reduce((t, [name, q]) => t + q * price(name), 0)
  const add = (name, d = 1) => {
    setResult(null)
    setCart((c) => ({ ...c, [name]: Math.max((c[name] || 0) + d, 0) }))
  }
  const shown = store.products.filter(
    (p) => (dept === 'All' || p.section === dept) && p.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const other = storeKey === 'volt' ? STORES['fresh-basket'] : STORES.volt
  const allLabel = grid ? 'All aisles' : 'All departments'

  function done(d) {
    setState(d.state)
    setResult(d.status)
    if (d.status === 'approved') setCart({})
  }

  async function checkout() {
    if (!total || busy) return
    setBusy(true)
    try {
      done(
        await customerApi('/api/customer/purchase', {
          account_id: id,
          merchant: store.name,
          category: `${store.category}: ${items.map(([n, q]) => `${q}× ${n}`).join(', ')}`.slice(0, 60),
          amount: Math.round(total * 100) / 100,
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const stepper = (p) =>
    cart[p.name] ? (
      <div className="sh-qty">
        <button type="button" onClick={() => add(p.name, -1)} aria-label={`Remove one ${p.name}`}>−</button>
        <span aria-live="polite">{cart[p.name]}</span>
        <button type="button" onClick={() => add(p.name)} aria-label={`Add one ${p.name}`}>+</button>
      </div>
    ) : (
      <button type="button" className="sh-add" onClick={() => add(p.name)}>
        {grid ? 'Add' : 'Add to Cart'}
      </button>
    )

  return (
    <div className={`sh sh-${store.theme}`}>
      <div className="sh-util">
        <span>{grid ? 'Delivery to M5V · Today, 4–6 pm' : 'Free shipping over $35 · Store pickup in 1 hour'}</span>
        <span>
          Demo store to illustrate the agent · paying as customer {id} ·{' '}
          <a href={`#/shop/${other.key}?account=${id}`}>Go to {other.name}</a>
        </span>
      </div>

      <header className="sh-head">
        <p className="sh-logo">{grid ? 'fresh basket' : 'VOLT'}</p>
        <label className="sh-search">
          <span className="sh-vh">{store.search}</span>
          <input type="search" placeholder={store.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <a className="sh-cartlink" href="#cart" onClick={(e) => { e.preventDefault(); document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth' }) }}>
          Cart <span className="sh-count">{count}</span>
        </a>
      </header>

      <nav className="sh-nav" aria-label="Departments">
        {['All', ...store.sections].map((s) => (
          <button key={s} type="button" aria-pressed={dept === s} onClick={() => setDept(s)}>
            {s === 'All' ? allLabel : s}
          </button>
        ))}
      </nav>

      <main className="sh-main">
        <section aria-label="Products">
          <p className="sh-crumb">{dept === 'All' ? allLabel : dept} · {shown.length} results</p>

          {grid ? (
            <ul className="sh-grid">
              {shown.map((p) => (
                <li key={p.name} className="sh-item">
                  <div className={`sh-pack${p.dark ? ' is-light' : ''}`} style={{ '--pack': p.pack }} aria-hidden="true">
                    <span className="sh-pack-brand">fresh basket</span>
                    <span className="sh-pack-name">{p.name}</span>
                    <span className="sh-pack-size">{p.size}</span>
                  </div>
                  <p className="sh-price">{cad(p.price)}</p>
                  <p className="sh-unit">{p.unit}</p>
                  <p className="sh-name">{p.name}</p>
                  <p className="sh-size">{p.size}</p>
                  {stepper(p)}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="sh-list">
              {shown.map((p) => (
                <li key={p.name} className="sh-row">
                  <div className="sh-shot" aria-hidden="true"><span>{p.art}</span></div>
                  <div className="sh-row-info">
                    <p className="sh-name">{p.name}</p>
                    <p className="sh-sku">Model {p.sku}</p>
                    <ul className="sh-specs">{p.specs.map((x) => <li key={x}>{x}</li>)}</ul>
                    <p className="sh-ship">Free shipping · Pickup today</p>
                  </div>
                  <div className="sh-row-buy">
                    <p className="sh-price">{cad(p.price)}</p>
                    {p.was ? <p className="sh-save">Save {cad(p.was - p.price)} <s>Was {cad(p.was)}</s></p> : null}
                    {stepper(p)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.length === 0 && <p className="sh-none">No results for “{query}”.</p>}
        </section>

        <aside className="sh-side">
          <section className="sh-cart" id="cart" aria-labelledby="cart-h">
            <h2 id="cart-h">Cart{count ? ` (${count})` : ''}</h2>
            {items.length === 0 ? (
              <p className="sh-empty">Your cart is empty.</p>
            ) : (
              <ul>
                {items.map(([n, q]) => (
                  <li key={n}>
                    <span>{q} × {n}</span>
                    <span>{cad(q * price(n))}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="sh-total"><span>Subtotal</span><span>{cad(total)}</span></p>
            <button type="button" className="sh-checkout" disabled={!total || busy} onClick={checkout}>
              {busy ? 'Processing…' : 'Check out with card'}
            </button>
            {total > 0 && (
              <>
                <p className="sh-or">or</p>
                <PayPalButtons id={id} store={store} items={items.map(([name, qty]) => ({ name, qty, price: price(name) }))} onDone={done} />
              </>
            )}
            {result === 'approved' && <p className="sh-note">Order placed. Thank you.</p>}
            {result === 'held' && <p className="sh-note is-hold">Payment on hold. Check your phone.</p>}
            <p className="sh-bal">Card balance {state ? money(state.balance) : '—'}</p>
          </section>
          <Phone id={id} state={state} setState={setState} compact />
        </aside>
      </main>
    </div>
  )
}
