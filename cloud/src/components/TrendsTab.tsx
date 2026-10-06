'use client'

/**
 * Trends — the Discovery tab (Geno, 2026-10-06): what the US is searching,
 * what the library's watched accounts are breaking out with, which sounds
 * are spreading, and a "Trends AI" box that answers questions grounded in
 * exactly that board — plus the web, when asked and when the key allows.
 *
 * Same day, round two: a window picker (today → 7 days), direction chips
 * and mini line graphs on terms and sounds, poster cards on the breakouts
 * (the library's stored thumbs — the sightings links die in hours), a Save
 * button on a sound while a stored copy is still alive, and the permanent
 * "Use on Instagram" audio-page link.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { sparkPoints, TREND_RANGES, type Direction, type TrendRange, type TrendsBoard } from '@/lib/trends-feed'

type Exchange = { question: string; answer?: string; error?: string; note?: string }

const RANGE_LABEL: Record<TrendRange, string> = { 1: 'Today', 2: '2 days', 3: '3 days', 7: '7 days' }

const EXAMPLES = [
  'What’s trending today?',
  'Any Google trend our library is already proving?',
  'Which sound should we jump on this week?',
]

const SPARK_W = 72
const SPARK_H = 20

function compact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** The mini line graph. One day of history draws a flat midline — honest,
 *  and it fills in by itself as the table accrues days. */
function Spark({ series }: { series: number[] }) {
  if (series.length < 2) return null
  return (
    <svg className="trends-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden="true">
      <polyline points={sparkPoints(series, SPARK_W, SPARK_H)} />
    </svg>
  )
}

const DIR_GLYPH: Record<Direction, string> = { up: '▲', down: '▼', steady: '—', new: '✦' }
const DIR_WORD: Record<Direction, string> = { up: 'up', down: 'down', steady: 'steady', new: 'new' }

function Dir({ direction }: { direction: Direction }) {
  return (
    <i className="trends-dir" data-dir={direction} title={`Trending ${DIR_WORD[direction]}`}>
      {DIR_GLYPH[direction]} {DIR_WORD[direction]}
    </i>
  )
}

export default function TrendsTab() {
  const [board, setBoard] = useState<TrendsBoard | null>(null)
  const [days, setDays] = useState<TrendRange>(1)
  const [failed, setFailed] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [web, setWeb] = useState(false)
  const [thread, setThread] = useState<Exchange[]>([])
  const [asking, setAsking] = useState(false)
  const threadEnd = useRef<HTMLDivElement>(null)

  const load = useCallback(async (want: TrendRange) => {
    const response = await fetch(`/api/trends?days=${want}`).catch(() => null)
    if (!response?.ok) return setFailed(true)
    setBoard(await response.json())
    setFailed(false)
  }, [])

  useEffect(() => { void load(days) }, [load, days])

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [thread])

  /** Today's feed on demand — first run, or "the cron is hours away". */
  async function pullNow() {
    setPulling(true)
    setPullError(null)
    const response = await fetch(`/api/trends?days=${days}`, { method: 'POST' }).catch(() => null)
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
      body: JSON.stringify({ question: asked, days, web }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setThread((current) => current.map((entry, index) => {
      if (index !== current.length - 1) return entry
      if (!response?.ok || !body?.answer) return { ...entry, error: body?.error ?? 'No answer came back — try again.' }
      const note = web && body.web === false
        ? 'Web search needs the Anthropic key on Vercel — this came from the board only.'
        : undefined
      return { ...entry, answer: String(body.answer), note }
    }))
    setAsking(false)
  }

  if (failed) return <p className="trends-empty">The board would not load — reload the page.</p>
  if (!board) return <p className="trends-empty">Reading the board…</p>

  const stale = board.captured_on !== new Date().toISOString().slice(0, 10)
  const windowWord = days === 1 ? 'today' : `the past ${days} days`

  return (
    <div className="trends">
      <header className="trends-head">
        <div>
          <p className="trends-kicker">Discovery</p>
          <h2 className="trends-title">Trends</h2>
          <p className="trends-sub">
            {board.captured_on
              ? `Google terms through ${board.captured_on}${stale ? ' — the next pull lands with the 10:00 pass' : ''}`
              : 'No Google pull has run yet'}
          </p>
        </div>
        <div className="trends-head-tools">
          {/* The window. One pull a day means "today" and "24 hours" are the
              same snapshot; the longer spans deepen as the table accrues. */}
          <nav className="trends-ranges" aria-label="Window">
            {TREND_RANGES.map((range) => (
              <button
                key={range}
                type="button"
                className="trends-range"
                data-on={days === range || undefined}
                aria-pressed={days === range}
                onClick={() => setDays(range)}
              >
                {RANGE_LABEL[range]}
              </button>
            ))}
          </nav>
          <button type="button" className="trends-pull" onClick={() => void pullNow()} disabled={pulling}>
            {pulling ? 'Pulling…' : 'Pull today’s trends'}
          </button>
        </div>
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
                {entry.note && <p className="trends-note">{entry.note}</p>}
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
            placeholder={`Ask about ${windowWord}’s trends…`}
            aria-label="Ask about the window's trends"
            maxLength={500}
          />
          <button type="submit" disabled={asking || !question.trim()}>
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </form>
        <label className="trends-web">
          <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
          Search the web too — for anything past the board’s own data
        </label>
        <p className="trends-foot">
          Grounded in the three panels below over {windowWord}
          {web ? ', plus live web search' : ''}.
        </p>
      </section>

      <div className="trends-grid">
        <section className="trends-panel" aria-label="Trending on Google">
          <p className="trends-panel-kicker">Google search · US · {RANGE_LABEL[days].toLowerCase()}</p>
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
                    {days > 1 && <Dir direction={term.direction} />}
                    {days > 1 && <Spark series={term.spark} />}
                    {days > 1 && <span>{term.days_seen}/{days} days</span>}
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
          {/* Reels land with Friday's weekly pass, so these two panels hold
              their 7-day floor whatever the picker says — a 48-hour reel
              window would be empty most of the week. */}
          <p className="trends-panel-kicker">Library breakouts · 7 days</p>
          {board.breakouts.length === 0 ? (
            <p className="trends-empty">No watched account beat its usual 2× in the window.</p>
          ) : (
            <ol className="trends-cards">
              {board.breakouts.map((reel) => (
                <li key={reel.post_id} className="trends-card">
                  {reel.thumb_job ? (
                    <a className="trends-card-visual" href={reel.url ?? undefined} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/thumb/${reel.thumb_job}`} alt="" loading="lazy" />
                      <b className="trends-card-mult">{reel.multiple}×</b>
                    </a>
                  ) : (
                    <span className="trends-card-visual trends-card-blank" aria-hidden="true">
                      <b className="trends-card-mult">{reel.multiple}×</b>
                    </span>
                  )}
                  <span className="trends-card-body">
                    {reel.url
                      ? <a className="trends-card-handle" href={reel.url} target="_blank" rel="noreferrer">@{reel.handle}</a>
                      : <b className="trends-card-handle">@{reel.handle}</b>}
                    <span className="trends-plays">{compact(reel.plays)} plays · {reel.multiple}× their usual</span>
                    {reel.caption && <span className="trends-reel-caption">{reel.caption}</span>}
                    {reel.audio_title && <span className="trends-reel-sound">♪ {reel.audio_title}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="trends-panel" aria-label="Sounds spreading">
          <p className="trends-panel-kicker">Sounds spreading · 7 days</p>
          {board.sounds.length === 0 ? (
            <p className="trends-empty">No sound reached two watched creators in the window.</p>
          ) : (
            <ol className="trends-sounds">
              {board.sounds.map((sound) => (
                <li key={sound.title}>
                  <span className="trends-sound-name">♪ {sound.title}{sound.artist ? ` — ${sound.artist}` : ''}</span>
                  <span className="trends-term-meta">
                    <b>{sound.creators} creators</b>
                    <Dir direction={sound.direction} />
                    <Spark series={sound.spark} />
                    <span className="trends-plays">{compact(sound.plays)} plays</span>
                  </span>
                  <span className="trends-sound-acts">
                    {sound.audio_id && (
                      <a
                        className="trends-sound-act"
                        href={`https://www.instagram.com/reels/audio/${sound.audio_id}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Use on Instagram
                      </a>
                    )}
                    {/* Only while a stored copy is still alive — Instagram's
                        links die in hours; Scout's next pass renews them. */}
                    {sound.fresh_audio && (
                      <a className="trends-sound-act" href={`/api/trends/sound?title=${encodeURIComponent(sound.title)}`}>
                        Save file
                      </a>
                    )}
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
