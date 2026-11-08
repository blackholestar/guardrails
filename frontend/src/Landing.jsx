import { useEffect, useMemo, useRef, useState } from 'react'
import accounts from './data/accounts.json'
import { runway, shareRunningOut, money } from './runway'
import './landing.css'

// Two real customers used as worked examples (numbers from the README formulas).
const C20111 = { I: 6339.39, S: 8599.6, B: 17611.86, H: 0, P: 2330.19 }
const C20134 = { I: 7958.0, S: 8060.52, B: 16599.46, H: 5166.31 }

const EXAMPLES = ['Laid off, bills up 15%', 'Furnace dies, $8,000 repair', 'Rent up $400 a month']

// Reads a typed twist card into shock parameters. Plain rules, shown to the visitor.
function parseTwist(text) {
  const t = text.toLowerCase()
  const s = {}
  const read = []
  if (/laid off|lost (my|their|his|her)? ?job|job loss|fired|unemploy/.test(t)) {
    s.income_multiplier = 0.55
    read.push(['Income', 'EI pays 55%'])
  }
  const bills = t.match(/bills? (?:up|rise|go up)[^0-9]*(\d+)\s*%/)
  if (bills) {
    s.bills_pct = Number(bills[1]) / 100
    read.push(['Household bills', `up ${bills[1]}%`])
  }
  const rent = t.match(/rent (?:up|rise|goes up)[^0-9$]*\$?\s*([\d,]+)/)
  if (rent) {
    s.extra_monthly = Number(rent[1].replace(/,/g, ''))
    read.push(['Extra each month', money(s.extra_monthly)])
  }
  const cost = t.match(/\$\s*([\d,]+)\s*(?:repair|bill|cost)|(?:repair|costs?)[^0-9$]*\$\s*([\d,]+)/)
  if (cost) {
    s.one_off_cost = Number((cost[1] || cost[2]).replace(/,/g, ''))
    read.push(['One-off cost', money(s.one_off_cost)])
  }
  return { s, read }
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]')
    if (!('IntersectionObserver' in window)) return
    document.documentElement.classList.add('js-reveal')
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
      { threshold: 0.15 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// Header takes the ink of the chapter under it (colour by chapter).
function useChapterInk(headerRef) {
  useEffect(() => {
    const chapters = [...document.querySelectorAll('[data-ink]')]
    const onScroll = () => {
      const y = (headerRef.current?.offsetHeight ?? 60) / 2
      const under = chapters.find((c) => {
        const r = c.getBoundingClientRect()
        return r.top <= y && r.bottom > y
      })
      if (headerRef.current && under) headerRef.current.dataset.on = under.dataset.ink
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [headerRef])
}

function Headline() {
  // One h1 whose ink inverts across the seam: white text blended with "difference" reads dark on the
  // sky field and light on the road field. The photo inside it is excluded from the blend.
  return (
    <h1 className="hl">
      <span className="hl-line">
        <span className="hl-ink">Stay on</span>{' '}
        <span className="hl-slot">
          <img src="/guardrail-pa090122.jpg" alt="A steel guardrail along a country road" width="1800" height="1350" />
        </span>
      </span>
      <span className="hl-line"><span className="hl-ink">the road.</span></span>
    </h1>
  )
}

export default function Landing() {
  const headerRef = useRef(null)
  useReveal()
  useChapterInk(headerRef)

  const [kept, setKept] = useState(55)
  const share = useMemo(() => shareRunningOut(accounts.rows, kept / 100), [kept])

  const [twist, setTwist] = useState(EXAMPLES[0])
  const parsed = useMemo(() => parseTwist(twist), [twist])
  const before = runway(C20134)
  const after = runway(C20134, parsed.s)

  const [acct, setAcct] = useState('20134')

  const ei = runway(C20111, { income_multiplier: 0.55 })
  const eiPaused = runway(C20111, { income_multiplier: 0.55, extra_monthly: -C20111.P })
  const covered = Math.min(ei.months, 6)

  return (
    <div className="lp">
      <header className="lp-bar" ref={headerRef} data-on="paper">
        <a className="lp-mark" href="#/">Guardrails</a>
        <nav className="lp-links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#/findings">Findings</a>
          <a className="lp-btn" href="#/engine">Open the engine</a>
        </nav>
      </header>

      <section className="hero" data-ink="paper">
        <div className="hero-fields" aria-hidden="true">
          <div className="f-up" />
          <div className="f-down" />
        </div>
        <Headline />
        <p className="hero-sub">
          Guardrails shows how many months a Tangerine customer&rsquo;s savings would last after a job loss or a
          surprise bill, and which moves keep them going.
        </p>
      </section>

      <figure className="band" data-ink="road">
        <img src="/hwy403-mississauga-ontario.jpg" alt="Traffic on Highway 403 in Mississauga, looking toward the city centre" width="1800" height="1350" loading="lazy" />
        <figcaption>Highway 403, Mississauga</figcaption>
      </figure>

      <section className="ch ch-green stats" data-ink="green" aria-labelledby="q-paycheque">
        <div className="stats-top" data-reveal>
          <h2 id="q-paycheque" className="h-q">What if the paycheque shrank?</h2>
          <div className="slider" data-ui>
            <label htmlFor="kept">
              Income kept after a job loss <output htmlFor="kept">{kept}%</output>
            </label>
            <input id="kept" type="range" min="0" max="100" step="5" value={kept} onChange={(e) => setKept(Number(e.target.value))} />
            <div className="slider-ends"><span>Nothing</span><span>EI pays 55%</span><span>Full pay</span></div>
          </div>
        </div>
        <div className="stats-bottom" data-reveal>
          <p className="big-figure" aria-live="polite">
            {Math.round(share * 100)}<span className="unit">%</span>
          </p>
          <p className="working">
            of 4,500 real customers would run out of savings within 6 months. Each account: savings ÷ (typical spending − income kept).
          </p>
        </div>
      </section>

      <section className="ch ch-paper how" id="how" data-ink="paper" aria-labelledby="h-how">
        <h2 id="h-how" className="h-big" data-reveal>Where the road runs out</h2>
        <div className="stagebar" data-ui data-reveal>
          <div className="seg seg-steel" style={{ flexGrow: covered }}>
            <span className="seg-dur">{ei.label} months</span>
          </div>
          <div className="seg seg-orange" style={{ flexGrow: Math.max(6 - covered, 0.72) }}>
            <span className="seg-dur">{(6 - covered).toFixed(1)} months short</span>
          </div>
        </div>
        <div className="stage-notes" data-reveal>
          <p style={{ flexGrow: covered }}>
            First, account 20111 loses their job. On EI their savings cover {ei.label} of the 6 months.
          </p>
          <p style={{ flexGrow: Math.max(6 - covered, 0.72) }}>
            Then the gap. Pausing the {money(C20111.P)} loan payment stretches savings to {eiPaused.label} months.
          </p>
        </div>
      </section>

      <section className="fields" aria-label="What Guardrails does">
        <div className="field fld-road" data-ink="road">
          <p className="fld-text" data-reveal>Look up any of 4,500 customers: income, bills, savings and months of runway, each worked out with the judges&rsquo; formulas.</p>
          <h2 className="fld-phrase" data-reveal>Know the road</h2>
        </div>
        <div className="field fld-orange alt" data-ink="orange">
          <p className="fld-text" data-reveal>Apply a job loss on EI, a rent rise, a furnace repair, or all three at once. Runway updates as you drag.</p>
          <h2 className="fld-phrase" data-reveal>See the hit</h2>
        </div>
        <div className="field fld-green" data-ink="green">
          <p className="fld-text" data-reveal>Moves ranked for this customer: pause a loan, trim cash spending, add income. Each shows the months it buys.</p>
          <h2 className="fld-phrase" data-reveal>Steer back</h2>
        </div>
        <div className="field fld-steel alt" data-ink="paper">
          <p className="fld-text" data-reveal>Protections the customer turns on: a check before big purchases and a locked reserve. Rent and bills always go through.</p>
          <h2 className="fld-phrase" data-reveal>Rails you choose</h2>
        </div>
      </section>

      <section className="ch ch-paper twist" data-ink="paper" aria-labelledby="h-twist">
        <div className="twist-main">
          <h2 id="h-twist" className="h-q" data-reveal>Read a twist card</h2>
          <input
            className="twist-input"
            data-ui
            aria-label="Twist card"
            value={twist}
            onChange={(e) => setTwist(e.target.value)}
            spellCheck="false"
          />
          <div className="twist-answer" data-ui aria-live="polite">
            <p className="ta-title">Account 20134</p>
            {parsed.read.length === 0 ? (
              <p className="ta-row muted">No shock read yet. Try &ldquo;laid off&rdquo;, &ldquo;bills up 20%&rdquo; or &ldquo;$3,000 repair&rdquo;.</p>
            ) : (
              parsed.read.map(([k, v]) => (
                <p className="ta-row" key={k}><span>{k}</span><span>{v}</span></p>
              ))
            )}
            <p className="ta-row ta-total">
              <span>Runway</span>
              <span className="num">
                {before.noShortfall ? 'No shortfall' : `${before.label} mo`} → {after.noShortfall ? 'No shortfall' : `${after.label} months`}
              </span>
            </p>
          </div>
          <div className="twist-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="ex" onClick={() => setTwist(ex)}>{ex}</button>
            ))}
          </div>
        </div>
        <figure className="twist-photo" data-reveal>
          <img src="/queen-elizabeth-way-26780561013.jpg" alt="An orange construction-zone sign for the Queen Elizabeth Way toward Toronto" width="1350" height="1800" loading="lazy" />
          <figcaption>Construction zone on the QEW</figcaption>
        </figure>
      </section>

      <section className="ch ch-road cta" data-ink="road" aria-labelledby="h-cta">
        <form
          className="cta-line"
          onSubmit={(e) => {
            e.preventDefault()
            if (/^\d+$/.test(acct)) window.location.hash = `#/engine?account=${acct}`
          }}
        >
          <h2 id="h-cta" className="cta-sentence">
            Take account{' '}
            <input className="cta-input" aria-label="Account ID" inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ''))} />
            <br /> for a{' '}
            <button className="cta-go" type="submit">drive</button>
          </h2>
          <p className="cta-note">Opens the engine with that customer loaded. Accounts run from 20111 to 99984.</p>
        </form>
      </section>

      <footer className="ch ch-orange foot" data-ink="orange">
        <div className="foot-top">
          <p>Guardrails, a resilience engine for Tangerine customers.</p>
          <p>Built at the Sheridan Datathon, November 7 and 8, 2026, Mississauga.</p>
          <a href="#/" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</a>
        </div>
        <figure className="foot-photo">
          <img src="/highway-401-at-hurontario-street-9192877703.jpg" alt="Highway 401 crossing Hurontario Street in Mississauga, seen from the air" width="1800" height="1350" loading="lazy" />
        </figure>
        <a className="foot-contact" href="https://github.com/blackholestar/sheridan-datathon">
          See the code
        </a>
        <div className="foot-meta">
          <span><a href="#/engine">Engine</a> · <a href="#/findings">Findings</a></span>
          <span>
            Photos via Wikimedia Commons and Openverse (CC BY / BY-SA): Guardrail PA090122; HWY403, Mississauga; Queen Elizabeth Way; Highway 401 at
            Hurontario Street. Data: PKDD&rsquo;99 Financial dataset.
          </span>
          <span>Mississauga, 2026</span>
        </div>
      </footer>
    </div>
  )
}
