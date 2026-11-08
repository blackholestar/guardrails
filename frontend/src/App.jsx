import { useEffect, useState } from 'react'
import Landing from './Landing'
import Dashboard from './Dashboard'

// Hash routes: #/ landing, #/engine?account=ID, #/findings
const isApp = () => /^#\/(engine|findings)/.test(window.location.hash)

export default function App() {
  const [app, setApp] = useState(isApp)
  useEffect(() => {
    const on = () => { setApp(isApp()); if (!window.location.hash.startsWith('#how')) window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return app ? <Dashboard /> : <Landing />
}
