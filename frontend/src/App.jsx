import { useEffect, useState } from 'react'
import AccountPage from './AccountPage'
import Landing from './Landing'

// Hash routes: #/engine (optionally ?account=ID) opens the app page; anything else shows the landing page.
// Plain in-page anchors such as #how stay on the landing page.
function readHash() {
  const [path, q] = window.location.hash.replace(/^#\/?/, '').split('?')
  if (path !== 'engine') return { page: 'landing' }
  return { page: 'engine', account: new URLSearchParams(q || '').get('account') }
}

export default function App() {
  const [route, setRoute] = useState(readHash)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (route.page === 'engine') window.scrollTo(0, 0)
  }, [route.page])

  if (route.page === 'engine') return <AccountPage key={route.account ?? ''} initialAccount={route.account} />
  return <Landing />
}
