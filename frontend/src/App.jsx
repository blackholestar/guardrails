import { useEffect, useState } from 'react'
import AccountPage from './AccountPage'
import Landing from './Landing'
import RailHero from './rail/RailHero'
import DrivePage from './drive/DrivePage'
import CustomerPage from './customer/CustomerPage'
import ShopPage from './customer/ShopPage'
import FindingsPage from './findings/FindingsPage'

// Hash routes: #/engine (optionally ?account=ID) opens the app page; anything else shows the landing page.
// Plain in-page anchors such as #how stay on the landing page.
function readHash() {
  const [path, q] = window.location.hash.replace(/^#\/?/, '').split('?')
  if (path === 'rail' || path === '') return { page: 'rail' } // the scroll story is the home page
  if (path === 'old') return { page: 'landing' }
  if (path === 'findings') return { page: 'findings' }
  if (path.startsWith('shop/')) return { page: 'shop', store: path.slice(5), account: new URLSearchParams(q || '').get('account') }
  if (path !== 'engine' && path !== 'classic' && path !== 'customer') return { page: 'rail' }
  return { page: path, account: new URLSearchParams(q || '').get('account') }
}

export default function App() {
  const [route, setRoute] = useState(readHash)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (route.page === 'engine' || route.page === 'classic' || route.page === 'findings') window.scrollTo(0, 0)
  }, [route.page])

  if (route.page === 'engine') return <DrivePage key={route.account ?? ''} initialAccount={route.account} />
  if (route.page === 'shop') return <ShopPage key={`${route.store}-${route.account}`} store={route.store} account={route.account} />
  if (route.page === 'customer') return <CustomerPage key={route.account ?? ''} account={route.account} />
  if (route.page === 'classic') return <AccountPage key={route.account ?? ''} initialAccount={route.account} />
  if (route.page === 'findings') return <FindingsPage />
  if (route.page === 'rail') return <RailHero />
  return <Landing />
}
