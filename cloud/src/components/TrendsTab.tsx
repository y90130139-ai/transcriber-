'use client'

/**
 * Trends — the Discovery tab (Geno, 2026-10-06): what the US is searching
 * today, what the library's watched accounts are breaking out with, which
 * sounds are spreading, and a "Trends AI" box that answers questions
 * grounded in exactly that board and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrendsBoard } from '@/lib/trends-feed'

type Exchange = { question: string; answer?: string; error?: string }

const EXAMPLES = [
  'What’s trending today?',
  'Any Google trend our library is already proving?',
  'Which sound should we jump on this week?',
]

function compact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export default function TrendsTab() {
  const [board, setBoard] = useState<TrendsBoard | null>(null)
  const [failed, setFailed] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [thread, setThread] = useState<Exchange[]>([])
  const [asking, setAsking] = useState(false)
  const threadEnd = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/trends').catch(() => null)
    if (!response?.ok) return setFailed(true)
    setBoard(await response.json())
    setFailed(false)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [thread])

  /** Today's feed on demand — first run, or "the cron is hours away". */
  async function pullNow() {
    setPulling(true)
    setPullError(null)
    const response = await fetch('/api/trends', { method: 'POST' }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && body?.board) setBoard(body.board)
    else setPullError(body?.error ?? 'The feed did not answer — try again in a minute.')
    setPulling(false)
  }

  async function ask(text?: string) {
    const asked = (text ?? question).trim()
    if (!asked || asking) return
    setQuestion('')
    setAsking(true)
    setThread((current) => [...current, { question: asked }])
    const response = await fetch('/api/trends/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: asked }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setThread((current) => current.map((entry, index) => index === current.length - 1
      ? response?.ok && body?.answer
        ? { ...entry, answer: String(body.answer) }
        : { ...entry, error: body?.error ?? 'No answer came back — try again.' }
      : entry))
    setAsking(false)
  }

  if (failed) return <p className="trends-empty">The board would not load — reload the page.</p>
  if (!board) return <p className="trends-empty">Reading the board…</p>

  const stale = board.captured_on !== new Date().toISOString().slice(0, 10)

  return (
    <div className="trends">
      <header className="trends-head">
        <div>
          <p className="trends-kicker">Discovery</p>
          <h2 className="trends-title">Trends</h2>
          <p className="trends-sub">
            {board.captured_on
              ? `Google terms from ${board.captured_on}${stale ? ' — the next pull lands with the 10:00 pass' : ''}`
              : 'No Google pull has run yet'}
          </p>
        </div>
        <button type="button" className="trends-pull" onClick={() => void pullNow()} disabled={pulling}>
          {pulling ? 'Pulling…' : 'Pull today’s trends'}
        </button>
      </header>
      {pullError && <p className="trends-error">{pullError}</p>}

      {/* The box first: the panels below are its evidence, not the feature. */}
      <section className="trends-ask" aria-label="Trends AI">
        <p className="trends-panel-kicker">Trends AI</p>
        {thread.length === 0 && (
          <div className="trends-examples">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="trends-example" onClick={() => void ask(example)}>
                {example}
              </button>
            ))}
          </div>
        )}
        {thread.length > 0 && (
          <div className="trends-thread">
            {thread.map((entry, index) => (
              <div key={index} className="trends-exchange">
                <p className="trends-q">{entry.question}</p>
                {entry.answer && <p className="trends-a">{entry.answer}</p>}
                {entry.error && <p className="trends-error">{entry.error}</p>}
                {!entry.answer && !entry.error && <p className="trends-a trends-waiting">Reading the board…</p>}
              </div>
            ))}
            <div ref={threadEnd} />
          </div>
        )}
        <form
          className="trends-form"
          onSubmit={(event) => { event.preventDefault(); void ask() }}
        >
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about today’s trends…"
            aria-label="Ask about today’s trends"
            maxLength={500}
          />
          <button type="submit" disabled={asking || !question.trim()}>
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </form>
        <p className="trends-foot">
          Answers only from the three panels below — Google search, library breakouts, spreading sounds.
        </p>
      </section>

      <div className="trends-grid">
        <section className="trends-panel" aria-label="Trending on Google">
          <p className="trends-panel-kicker">Google search · US</p>
          {board.terms.length === 0 ? (
            <p className="trends-empty">Nothing stored yet — pull today’s trends above.</p>
          ) : (
            <ol className="trends-terms">
              {board.terms.map((term) => (
                <li key={term.term}>
                  <span className="trends-term-name">
                    {term.term}
                    {term.rising && <i className="trends-new">new</i>}
                  </span>
                  <span className="trends-term-meta">
                    {term.traffic && <b>{term.traffic}</b>}
                    {term.news[0] && (
                      <a href={term.news[0].url} target="_blank" rel="noreferrer">{term.news[0].title}</a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="trends-panel" aria-label="Library breakouts">
          <p className="trends-panel-kicker">Library breakouts · 14 days</p>
          {board.breakouts.length === 0 ? (
            <p className="trends-empty">No watched account beat its usual 2× in the window.</p>
          ) : (
            <ol className="trends-reels">
              {board.breakouts.map((reel) => (
                <li key={reel.post_id}>
                  <span className="trends-reel-top">
                    {reel.url
                      ? <a href={reel.url} target="_blank" rel="noreferrer">@{reel.handle}</a>
                      : <b>@{reel.handle}</b>}
                    <b className="trends-mult">{reel.multiple}× usual</b>
                    <span className="trends-plays">{compact(reel.plays)} plays</span>
                  </span>
                  {reel.caption && <span className="trends-reel-caption">{reel.caption}</span>}
                  {reel.audio_title && <span className="trends-reel-sound">♪ {reel.audio_title}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="trends-panel" aria-label="Sounds spreading">
          <p className="trends-panel-kicker">Sounds spreading · 14 days</p>
          {board.sounds.length === 0 ? (
            <p className="trends-empty">No sound reached two watched creators in the window.</p>
          ) : (
            <ol className="trends-sounds">
              {board.sounds.map((sound) => (
                <li key={sound.title}>
                  <span className="trends-sound-name">♪ {sound.title}{sound.artist ? ` — ${sound.artist}` : ''}</span>
                  <span className="trends-term-meta">
                    <b>{sound.creators} creators</b>
                    <span className="trends-plays">{compact(sound.plays)} plays</span>
                    <span className="trends-handles">{sound.sample_handles.map((handle) => `@${handle}`).join(' ')}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
