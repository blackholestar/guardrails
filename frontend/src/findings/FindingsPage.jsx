import '../drive/drive.css'

// Our findings. Placeholder for now; the content comes next.
export default function FindingsPage() {
  return (
    <div className="dv">
      <header className="dv-bar">
        <a className="dv-mark" href="#/">Guardrails</a>
        <nav className="dv-nav" aria-label="Pages">
          <a className="dv-navlink" href="#/">The story</a>
          <a className="dv-navlink" href="#/engine">The engine</a>
        </nav>
      </header>
      <main className="dv-main">
        <div className="dv-head">
          <h1 className="dv-title">Our findings</h1>
          <p className="dv-sub">Coming soon.</p>
        </div>
      </main>
    </div>
  )
}
