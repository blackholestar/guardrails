import { useEffect, useRef, useState } from 'react'
import { runway, money } from '../runway'
import ACCOUNT_IDS from '../data/account_ids.json'
import './rail.css'

// Account 20111 (README formulas): income, spending, savings, loan payment.
const C20111 = { I: 6339.39, S: 8599.6, B: 17611.86, H: 0, P: 2330.19 }
const EI = { income_multiplier: 0.55 }
const today = runway(C20111).months
const laidOff = runway(C20111, EI).months
const guarded = runway(C20111, { ...EI, extra_monthly: -(C20111.P + 300) }).months
const f1 = (x) => x.toFixed(1)

// One chapter per camera keyframe in scene.js. Each sets how far the rail runs.
const CHAPTERS = [
  { rail: [today, 0] },
  {
    rail: [today, 0],
    title: 'Every post is a month.',
    body: `Account 20111 has ${money(C20111.B)} saved and spends ${money(C20111.S - C20111.I)} more than comes in each month. That is ${f1(today)} months of road.`,
  },
  {
    rail: [laidOff, 0],
    title: 'Then the job goes.',
    body: `On EI, income drops to 55%. The same savings now last ${f1(laidOff)} months, short of the six it takes to find work. One in three customers would run out before six months too.`,
  },
  {
    rail: [laidOff, 0],
    title: 'You’ll run out of money eventually.',
    body: 'Of customers who were ever overdrawn, 64% first came within $500 of zero, a median 13 months earlier. Guardrails watches for that dip.',
  },
  {
    rail: [laidOff, guarded - laidOff],
    title: 'Guardrails go up.',
    body: `Pause the ${money(C20111.P)} loan payment and take out $300 less cash a month. The orange rail is ${f1(guarded - laidOff)} more months. Rent and bills always go through.`,
  },
  { rail: [laidOff, guarded - laidOff], drive: true },
]
const LAST = CHAPTERS.length - 1
const VALID = new Set(ACCOUNT_IDS)

function openEngine(id) {
  window.location.hash = /^\d+$/.test(id) ? `#/engine?account=${id}` : '#/engine'
}

export default function RailHero() {
  const storyRef = useRef(null)
  const canvasRef = useRef(null)
  const tagRef = useRef(null)
  const sceneRef = useRef(null)
  const chapterNow = useRef(0)
  const [chapter, setChapter] = useState(0)
  const [failed, setFailed] = useState(false)
  const [acct, setAcct] = useState('')
  const [acctError, setAcctError] = useState('')

  const months = CHAPTERS[chapter].rail[0] + CHAPTERS[chapter].rail[1]

  // the 3D scene
  useEffect(() => {
    let alive = true
    let api
    let io
    const onMove = (e) => api?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1)
    const onResize = () => api?.resize()
    import('./scene.js')
      .then(({ createRailScene }) => {
        if (!alive) return
        try {
          api = createRailScene(canvasRef.current, {
            onFrame: ({ end }) => {
              if (tagRef.current) tagRef.current.style.transform = `translate(${end.x}px, ${end.y}px)`
            },
          })
        } catch {
          setFailed(true)
          return
        }
        sceneRef.current = api
        api.resize()
        api.setRunway(...CHAPTERS[chapterNow.current].rail)
        api.jump()
        api.start()
        io = new IntersectionObserver(([e]) => (e.isIntersecting ? api.start() : api.stop()))
        io.observe(canvasRef.current)
        window.addEventListener('pointermove', onMove, { passive: true })
        window.addEventListener('resize', onResize)
        window.dispatchEvent(new Event('scroll'))
      })
      .catch(() => setFailed(true))
    return () => {
      alive = false
      io?.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
      api?.dispose()
    }
  }, [])

  // scroll drives the chapter, the camera and the text.
  // Scroll guards: while the story is on screen, the page snaps one chapter per scroll gesture
  // (scroll-snap-stop: always), so a hard flick can't skip a chapter.
  useEffect(() => {
    const restore = history.scrollRestoration
    history.scrollRestoration = 'manual' // always start the drive at the top
    window.scrollTo(0, 0)
    const root = document.documentElement
    root.classList.add('rs-snap')
    let current = -1
    const onScroll = () => {
      const el = storyRef.current
      if (!el) return
      const vh = window.innerHeight
      const t = Math.max(-el.getBoundingClientRect().top / vh, 0) // viewports scrolled
      const stage = Math.min(t, LAST)
      sceneRef.current?.setStage(stage)
      el.querySelectorAll('[data-ch]').forEach((c) => {
        const d = stage - Number(c.dataset.ch)
        const o = Math.max(1 - Math.abs(d) * 2.2, 0)
        c.style.opacity = o
        c.style.transform = `translateY(${-d * 60}px)`
        c.style.visibility = o > 0.01 ? 'visible' : 'hidden'
      })
      const ch = Math.min(Math.round(stage), LAST)
      if (ch !== current) {
        current = ch
        chapterNow.current = ch
        setChapter(ch)
      }
      if (tagRef.current) tagRef.current.style.opacity = stage > LAST - 0.6 ? 0 : 1
    }
    // left and right arrows step through the chapters like down and up (not while typing)
    const onKey = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      window.scrollBy({ top: (e.key === 'ArrowRight' ? 1 : -1) * window.innerHeight, behavior: 'smooth' })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
      root.classList.remove('rs-snap')
      history.scrollRestoration = restore
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setRunway(...CHAPTERS[chapter].rail)
  }, [chapter])

  return (
    <div className="rs" ref={storyRef} style={{ '--chapters': CHAPTERS.length }}>
      {CHAPTERS.map((_, i) => (
        <div key={i} className="rs-stop" style={{ top: `${i * 100}svh` }} aria-hidden="true" />
      ))}
      <section className="rh" aria-label="Guardrails, a drive down the road">
        <canvas ref={canvasRef} className="rh-canvas" aria-hidden="true" />
        {failed && <div className="rh-fallback" aria-hidden="true" />}

        <div ref={tagRef} className="rh-tag" aria-hidden="true">
          <span className="rh-tag-num">{f1(months)}</span> months
        </div>

        <div className="rh-copy rh-ch" data-ch="0">
          <h1 className="rh-title">Guardrails.</h1>
          <p className="rh-sub">
            It shows how many months a Tangerine customer&rsquo;s savings would last after a job loss or a surprise
            bill, and turns on the protections that keep them going.
          </p>
          <a className="rh-findings" href="#/findings">
            See our findings <span aria-hidden="true">→</span>
          </a>
          <p className="rh-hint">Scroll to drive <span aria-hidden="true">↓</span></p>
        </div>

        {CHAPTERS.map((c, i) =>
          c.title ? (
            <div key={i} className="rh-step rh-ch" data-ch={i}>
              <h2 className="rh-h2">{c.title}</h2>
              <p className="rh-body">{c.body}</p>
            </div>
          ) : null,
        )}

        <form
          className="rh-step rh-drive rh-ch"
          data-ch={LAST}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!acct) return openEngine('')
            if (!VALID.has(Number(acct))) return setAcctError(`There is no account ${acct}. IDs run from 20111 to 99984.`)
            openEngine(acct)
          }}
        >
          <h2 className="rh-h2">Now pick any customer.</h2>
          <p className="rh-body">
            All 4,500 accounts are in the engine. Type the one the judges call out, or pick at random. It works out their
            runway, takes the twist card, and builds their plan.
          </p>
          <div className="rh-pick">
            <label className="rh-pick-field">
              <span>Account ID</span>
              <input
                className="rh-acct-input"
                inputMode="numeric"
                placeholder="e.g. 20134"
                value={acct}
                aria-invalid={acctError ? 'true' : undefined}
                aria-describedby="rh-acct-error"
                onChange={(e) => {
                  setAcct(e.target.value.replace(/\D/g, '').slice(0, 5))
                  setAcctError('')
                }}
              />
            </label>
            <button type="submit" className="rh-go">
              Open the engine <span aria-hidden="true">→</span>
            </button>
          </div>
          <p id="rh-acct-error" className="rh-error" aria-live="polite">{acctError}</p>
          <p className="rh-try">
            Or try{' '}
            {['20134', '20111'].map((id) => (
              <button key={id} type="button" className="rh-link" onClick={() => openEngine(id)}>
                {id}
              </button>
            ))}
            <button type="button" className="rh-link" onClick={() => openEngine(String(ACCOUNT_IDS[Math.floor(Math.random() * ACCOUNT_IDS.length)]))}>
              a random account
            </button>
          </p>
        </form>
      </section>
    </div>
  )
}
