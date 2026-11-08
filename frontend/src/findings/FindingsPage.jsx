import '../drive/drive.css'
import './findings.css'

// Our findings, told the way we found them: each step is what we asked, the graph, what we saw, and the
// question it raised next. Charts come from eda/eda.ipynb and findings/figures; numbers from their output.

const STEPS = [
  {
    n: '01',
    title: 'We started with no theory',
    asked: 'What does the money actually do? We turned 4,500 accounts into the judges’ figures and plotted everything.',
    img: '2-first-plots.png',
    alt: 'Four charts: income vs spending, where money goes, months overdrawn, and correlations with runway',
    saw: [
      'Most people spend close to what they earn, so lost income turns into a gap almost at once.',
      'About two thirds of a typical customer’s money out is cash. Bills are a fifth.',
      'Only about 6% were ever overdrawn: a rare outcome we would have to catch early.',
      'Income ran the wrong way against runway (−0.68). That one bar started everything below.',
    ],
    next: 'Which of these move together?',
  },
  {
    n: '02',
    title: 'Then every variable against every other',
    asked: 'Which things move together? Twelve per-customer measures, every pair correlated.',
    img: '2c-matrix.png',
    alt: 'Correlation matrix of twelve customer measures',
    saw: [
      { text: 'Income and spending move almost in lockstep (.97): earning more mostly means spending more.', hint: '04', why: 'why higher earners fall short' },
      { text: 'Richer customers hold more savings in dollars (.58) but fewer months of savings (−.74). Months are what runway is made of (.95).', hint: '04', why: 'checked by income group' },
      { text: 'A high cash share goes with unsteady income (.53).', hint: 'cash', why: 'what people cut in a crash' },
      { text: 'Against runway, income steadiness (−.22) and the lowest balance (.14) looked weak. Runway isn’t the only outcome, though: loans have a real one.', hint: '06', why: 'tested against loan defaults' },
    ],
    next: 'So how many people would actually make it through a shock?',
  },
  {
    n: '03',
    title: 'One job loss puts a third at risk',
    asked: 'Using the judges’ formulas, how many run out of savings within 6 months under each shock in the brief?',
    img: '3-shocks.png',
    alt: 'Bar chart of the share of customers who run out within 6 months under each shock',
    saw: ['A single job loss on EI leaves about a third of customers out of money within 6 months.'],
    next: 'We guessed these would be the low earners. Were they?',
  },
  {
    n: '04',
    title: 'Surprise: higher earners survive less often',
    asked: 'Does surviving a job loss rise with income? Working customers only, since a layoff can’t cut a pension.',
    img: '4-higher-earners.png',
    alt: 'Survival rate and savings in months, by income quarter',
    saw: [
      'The opposite of our guess. The top income quarter survives least often.',
      'Higher earners spend more, so the same savings cover fewer months.',
    ],
    next: 'Could that be a quirk of the data, like side accounts that look poor?',
  },
  {
    n: '05',
    title: 'We checked before believing it',
    asked: 'Do the lowest earners look like real low earners, or like accounts where the money lives elsewhere?',
    img: '5-check.png',
    alt: 'Scatter of income vs savings for working customers',
    saw: ['They spend about what they earn, like real low earners. The pattern held.'],
    next: 'If income doesn’t tell you who gets into trouble, what does?',
  },
  {
    n: '06',
    title: 'Steady income and your worst day matter, not how much you earn',
    asked: 'Loans gave us a real outcome. Which signals from before a loan separate the ones that defaulted?',
    img: '6-default.png',
    alt: 'Default rate by income steadiness and by lowest balance before the loan',
    saw: [
      '615 loans with at least 6 months of history before the loan; 65 defaulted.',
      'Lowest balance of the year (AUC 0.82) and unsteady income (0.70) beat income level (0.56).',
      'A dip below $500 marks the loans that went bad.',
    ],
    next: 'Do these signals hold up with proper controls, and do they work in time?',
  },
  {
    n: '07',
    title: 'A lead we dropped',
    asked: 'Real income crashes seemed to cluster in January. 19% of first crashes started there, twice any other month.',
    img: '7-january.png',
    alt: 'Three charts: first crash by month, every crash by month, every low-income month by month',
    saw: [
      'Count every crash and January is level with February. Count every low-income month and each month is about 8%.',
      'The spike came from keeping only the first crash per account. We threw it out; nothing in Guardrails uses it.',
    ],
    lesson: 'Before believing a pattern, change how it is counted. If it moves, it was the counting.',
  },
]

const CONFIRMED = [
  {
    img: 'deep_1_validation.png',
    claim: 'The stress test predicts real trouble',
    detail: 'Runway if laid off, from 2024 data, against who was really overdrawn in 2025 (3,657 accounts): under 3 months, 17.7% overdrawn; 12+ months, 1.1%.',
    rail: 'Runway and the goal line',
  },
  {
    img: 'deep_3_default_odds.png',
    claim: 'Two warning signs for default',
    detail: 'Unsteady income (odds ratio 4.7 [2.5–8.8]) and a dip below $500 (4.9 [2.7–8.8]), controlling for income, savings and loan size. Income level is not significant.',
    rail: 'Loan deferral request',
  },
  {
    img: 'deep_6_warning_time.png',
    claim: 'A near-miss gives about a year’s warning',
    detail: '64% of overdrawn accounts first had a balance between $0 and $500. The overdraft came a median 13 months later.',
    rail: 'Low-balance alert at $500',
  },
  {
    img: 'deep_5_what_people_cut.png',
    claim: 'In a crash, cash moves and fixed costs don’t',
    detail: 'Across 569 real income crashes, cash withdrawals fell 59%. Household bills, insurance and loan payments did not change.',
    rail: 'Lower cash limit',
  },
]

export default function FindingsPage() {
  return (
    <div className="dv fx">
      <header className="dv-bar">
        <a className="dv-mark" href="#/">Guardrails</a>
        <nav className="dv-nav" aria-label="Pages">
          <a className="dv-navlink" href="#/">The story</a>
          <a className="dv-navlink" href="#/engine">The engine</a>
        </nav>
      </header>

      <main className="fx-main">
        <section className="fx-hero">
          <h1 className="fx-title">Our findings</h1>
          <p className="fx-lead">
            How we got there: we plotted 4,500 real bank customers with no theory, followed what looked odd, checked
            it, and dropped what didn’t hold. Every guardrail in the engine comes from the end of this trail.
          </p>
          <p className="fx-src">
            Full code: <code>eda/eda.ipynb</code> (this story) and <code>findings/findings_walkthrough.ipynb</code> (the tests).
          </p>
        </section>

        <ol className="fx-steps">
          {STEPS.map((s) => (
            <li key={s.n} id={`fx-step-${s.n}`} className="fx-step">
              <div className="fx-step-head">
                <span className="fx-n">{s.n}</span>
                <h2>{s.title}</h2>
              </div>
              <p className="fx-asked"><b>We asked</b>{s.asked}</p>
              <figure className="fx-fig">
                <img src={`/findings/${s.img}`} alt={s.alt} loading="lazy" />
              </figure>
              <div className="fx-saw">
                <b>We saw</b>
                <ul>
                  {s.saw.map((t) =>
                    typeof t === 'string' ? (
                      <li key={t}>{t}</li>
                    ) : (
                      <li key={t.text}>
                        {t.text}{' '}
                        <a className="fx-hint" href={`#/findings`} onClick={(e) => { e.preventDefault(); document.getElementById(t.hint === 'cash' ? 'fx-cash' : `fx-step-${t.hint}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                          {t.hint === 'cash' ? 'Leads to the cash finding' : `Leads to step ${t.hint}`}: {t.why} →
                        </a>
                      </li>
                    ),
                  )}
                </ul>
              </div>
              {s.lesson && <p className="fx-lesson">{s.lesson}</p>}
              {s.next && <p className="fx-next"><span aria-hidden="true">↓</span> {s.next}</p>}
            </li>
          ))}
        </ol>

        <section className="fx-confirm" aria-labelledby="fx-confirm-h">
          <h2 id="fx-confirm-h" className="fx-confirm-title">Where the trail led: tested findings, and the guardrail each became</h2>
          <div className="fx-cards">
            {CONFIRMED.map((c) => (
              <article key={c.img} id={c.img.includes('cut') ? 'fx-cash' : undefined} className="fx-card">
                <img src={`/findings/${c.img}`} alt={c.claim} loading="lazy" />
                <h3>{c.claim}</h3>
                <p>{c.detail}</p>
                <p className="fx-rail">Guardrail <span>{c.rail}</span></p>
              </article>
            ))}
          </div>
          <a className="fx-cta" href="#/engine">Try it on any account <span aria-hidden="true">→</span></a>
          <p className="fx-caveat">
            Data: PKDD’99 Financial dataset (real anonymized Czech bank data, re-dated to 2020–2025 and converted to CAD).
            The exact percentages belong to these customers; the patterns are what carry over.
          </p>
        </section>
      </main>
    </div>
  )
}
