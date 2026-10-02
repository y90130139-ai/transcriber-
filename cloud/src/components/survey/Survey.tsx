'use client'

import { useEffect, useState } from 'react'
import { BusyWeek, Days, Formats, IG_LINE, PerDay, Personas, SplitView, Times, Weekly, Wont, stepReady, toTopLine, type Draft } from './Steps'
import { paceBand, type Answers, type Lang } from '@/lib/survey/core'
import { PACE, RESULT, TOP_LINE, UI, fill } from '@/lib/survey/copy'

const STEPS = ['perDay', 'days', 'times', 'weekly', 'formats', 'wont', 'personas', 'busy'] as const
const VIEWS = { perDay: PerDay, days: Days, times: Times, weekly: Weekly, formats: Formats, wont: Wont, personas: Personas, busy: BusyWeek }

type Last = { answers: Answers; submitted_at: string } | null
type Result = { weekly: number }

const EMPTY: Draft = { per_day: null, days: [], times: [], weekly: null, formats: [], wont: [], personas: [], busy: null }
const fromAnswers = (a: Answers): Draft => ({ ...a })


export default function Survey({ token, name, photo, last }: { token: string; name: string; photo: string | null; last: Last }) {
  const [lang, setLang] = useState<Lang>(last?.answers.lang ?? 'en')
  // A Spanish phone gets Spanish, decided after hydration so the server's
  // render and the first client render agree. Her last answers win.
  useEffect(() => {
    if (!last && navigator.language?.toLowerCase().startsWith('es')) setLang('es')
  }, [last])
  // -1 is the intro; STEPS.length is the result.
  const [at, setAt] = useState(last ? STEPS.length : -1)
  const [draft, setDraft] = useState<Draft>(last ? fromAnswers(last.answers) : EMPTY)
  const [weeklyTouched, setWeeklyTouched] = useState(Boolean(last))
  const [result, setResult] = useState<Result | null>(last ? { weekly: last.answers.weekly } : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(patch: Partial<Draft>) {
    if ('weekly' in patch) setWeeklyTouched(true)
    setDraft((d) => ({ ...d, ...patch }))
  }

  function go(to: number) {
    // The weekly number is worked out from per day × days until she edits it.
    if (STEPS[to] === 'weekly' && !weeklyTouched && draft.per_day) {
      setDraft((d) => ({ ...d, weekly: Math.max(1, (d.per_day ?? 1) * Math.max(1, d.days.length)) }))
    }
    setError(null)
    setAt(to)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/plan/${token}/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, lang }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || UI.sendFailed[lang])
      setResult({ weekly: body.weekly })
      go(STEPS.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : UI.sendFailed[lang])
    } finally {
      setBusy(false)
    }
  }

  const step = STEPS[at]
  const View = step ? VIEWS[step] : null
  const isLast = at === STEPS.length - 1

  return (
    <main className="plan survey">
      <header className="plan-head sv-head">
        <div className="plan-who">
          {photo && <img className="plan-face" src={photo} alt="" width={44} height={44} />}
          <div>
            <p className="plan-eyebrow">{name}</p>
            <h1 className="sv-title">{UI.title[lang]}</h1>
          </div>
        </div>
        <div className="sv-lang" role="group" aria-label="Language">
          {(['en', 'es'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} data-on={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
        {View && (
          <div className="sv-progress" aria-label={fill(UI.step[lang], { n: at + 1, total: STEPS.length })}>
            <span style={{ transform: `scaleX(${(at + 1) / STEPS.length})` }} />
          </div>
        )}
      </header>

      {at === -1 && (
        <section className="sv-card">
          <p className="sv-lede">{UI.intro[lang]}</p>
          <Truths lang={lang} />
          <button type="button" className="plan-cta" onClick={() => go(0)}>{UI.start[lang]}</button>
        </section>
      )}

      {View && (
        <section className="sv-card" key={step}>
          <p className="sv-count">{fill(UI.step[lang], { n: at + 1, total: STEPS.length })}{(step === 'wont' || step === 'personas') && ` · ${UI.optional[lang]}`}</p>
          <View lang={lang} draft={draft} set={set} />
          {error && <p className="sv-why" data-tone="warn" role="alert">{error}</p>}
          <nav className="sv-nav">
            <button type="button" className="plan-cta plan-cta-quiet" onClick={() => go(at - 1)}>{UI.back[lang]}</button>
            {isLast ? (
              <button type="button" className="plan-cta" disabled={!stepReady(step, draft) || busy} onClick={() => void submit()}>
                {busy ? UI.sending[lang] : UI.submit[lang]}
              </button>
            ) : (
              <button type="button" className="plan-cta" disabled={!stepReady(step, draft)} onClick={() => go(at + 1)}>{UI.next[lang]}</button>
            )}
          </nav>
        </section>
      )}

      {at === STEPS.length && result && (
        <section className="sv-card sv-result">
          <p className="sv-count">{RESULT.title[lang]}</p>
          <p className="sv-tier">{result.weekly}<span>{RESULT.weekly[lang]}</span></p>
          <p className="sv-hint">{TOP_LINE[lang]}</p>
          <p className="sv-why" data-tone="good">{toTopLine(result.weekly, lang)}</p>
          <p className="sv-why" data-tone={PACE[paceBand(result.weekly)].tone}>{PACE[paceBand(result.weekly)].text[lang]}</p>
          <SplitView lang={lang} weekly={result.weekly} />
          <p className="sv-lede">{IG_LINE[lang]}</p>
          <Truths lang={lang} />
          <p className="sv-hint">{RESULT.saved[lang]}</p>
          <nav className="sv-nav">
            <button type="button" className="plan-cta plan-cta-quiet" onClick={() => go(0)}>{UI.retake[lang]}</button>
            <a className="plan-cta" href={`/p/${token}`}>{UI.openPlan[lang]}</a>
          </nav>
        </section>
      )}
    </main>
  )
}

function Truths({ lang }: { lang: Lang }) {
  return (
    <section className="sv-truths" aria-label={UI.truthsTitle[lang]}>
      <h2 className="sv-group-title">{UI.truthsTitle[lang]}</h2>
      <ul>{UI.truths[lang].map((line) => <li key={line}>{line}</li>)}</ul>
    </section>
  )
}
