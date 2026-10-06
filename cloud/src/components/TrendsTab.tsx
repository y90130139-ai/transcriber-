'use client'

/**
 * Trends — the Discovery tab (Geno, 2026-10-06): what the country is
 * searching, what the library's watched accounts are breaking out with,
 * which sounds are spreading, and a "Trends AI" box grounded in exactly
 * that board — plus the web, when asked and when the key allows.
 *
 * Round three, same day, off Geno's screenshot of trends.google.com: the
 * Google panel is now the live Trending Now list itself — the full list
 * (2,000+ over 7 days), each row with search volume, the spike, when it
 * started, and the breakdown terms whose names alone say what a trend is
 * about. A state picker, sort by volume/newest/relevance, and Export CSV.
 * The daily RSS archive stays as the fallback for a day Google sulks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  sparkPoints,
  startedLabel,
  TREND_RANGES,
  US_GEOS,
  volumeLabel,
  type Direction,
  type LiveTrend,
  type TrendRange,
  type TrendsBoard,
} from '@/lib/trends-feed'

type Exchange = { question: string; answer?: string; error?: string; note?: string }
type LiveSort = 'relevance' | 'volume' | 'recent'

const RANGE_LABEL: Record<TrendRange, string> = { 1: '24 h', 2: '48 h', 3: '3 days', 7: '7 days' }

const EXAMPLES = [
  'What’s trending today?',
  'Any Google trend our library is already proving?',
  'Which sound should we jump on this week?',
]

/** Rows on screen before "Show more" — the whole list stays exportable. */
const LIVE_PAGE = 30

const SPARK_W = 72
const SPARK_H = 20

function compact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** The mini line graph on the sounds panel. */
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

/** The current view as a file, for whatever wants it next (Geno: "export
 *  if we really wanted to"). Plain CSV, Excel-safe quoting. */
function exportCsv(rows: LiveTrend[], geo: string, days: TrendRange) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  const lines = [
    'trend,search_volume,spike_pct,started,breakdown',
    ...rows.map((row) => [
      quote(row.term),
      volumeLabel(row.volume) ?? '',
      row.pct !== null ? `+${row.pct}%` : '',
      startedLabel(row.started) ?? '',
      quote(row.breakdown.join(' | ')),
    ].join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `trends-${geo}-${RANGE_LABEL[days].replace(' ', '')}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

export default function TrendsTab() {
  const [board, setBoard] = useState<TrendsBoard | null>(null)
  const [days, setDays] = useState<TrendRange>(1)
  const [geo, setGeo] = useState('US')
  const [sort, setSort] = useState<LiveSort>('relevance')
  const [shown, setShown] = useState(LIVE_PAGE)
  const [failed, setFailed] = useState(false)
  const [question, setQuestion] = useState('')
  const [web, setWeb] = useState(false)
  const [thread, setThread] = useState<Exchange[]>([])
  const [asking, setAsking] = useState(false)
  const threadEnd = useRef<HTMLDivElement>(null)

  const load = useCallback(async (wantDays: TrendRange, wantGeo: string) => {
    const response = await fetch(`/api/trends?days=${wantDays}&geo=${wantGeo}`).catch(() => null)
    if (!response?.ok) return setFailed(true)
    setBoard(await response.json())
    setFailed(false)
  }, [])

  useEffect(() => {
    setShown(LIVE_PAGE)
    void load(days, geo)
  }, [load, days, geo])

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [thread])

  const live = useMemo(() => {
    const rows = board?.live ?? []
    if (sort === 'volume') return [...rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || (b.pct ?? 0) - (a.pct ?? 0))
    if (sort === 'recent') return [...rows].sort((a, b) => (b.started ?? 0) - (a.started ?? 0))
    return rows // relevance — Google's own order
  }, [board, sort])

  async function ask(text?: string) {
    const asked = (text ?? question).trim()
    if (!asked || asking) return
    setQuestion('')
    setAsking(true)
    setThread((current) => [...current, { question: asked }])
    const response = await fetch('/api/trends/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: asked, days, geo, web }),
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

  const placeName = US_GEOS.find((g) => g.code === geo)?.name ?? 'United States'
  const windowWord = days === 1 ? 'the past 24 hours' : `the past ${RANGE_LABEL[days]}`

  return (
    <div className="trends">
      <header className="trends-head">
        <div>
          <p className="trends-kicker">Discovery</p>
          <h2 className="trends-title">Trends</h2>
          <p className="trends-sub">
            {live.length > 0
              ? `${live.length.toLocaleString('en-US')} trends · ${placeName} · ${windowWord}`
              : 'Google is not answering — showing the daily archive'}
          </p>
        </div>
        <div className="trends-head-tools">
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
          <div className="trends-selects">
            <select value={geo} onChange={(event) => setGeo(event.target.value)} aria-label="Place">
              {US_GEOS.map((place) => (
                <option key={place.code} value={place.code}>{place.name}</option>
              ))}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as LiveSort)} aria-label="Order">
              <option value="relevance">By relevance</option>
              <option value="volume">By search volume</option>
              <option value="recent">Newest first</option>
            </select>
            {live.length > 0 && (
              <button type="button" className="trends-pull" onClick={() => exportCsv(live, geo, days)}>
                Export CSV
              </button>
            )}
          </div>
        </div>
      </header>

      {/* The box first: everything below is its evidence, not the feature. */}
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
            placeholder={`Ask about ${windowWord}…`}
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
          Grounded in Google’s live list for {placeName} plus the library panels below
          {web ? ', and live web search' : ''}.
        </p>
      </section>

      {/* Google's own Trending Now, whole. The breakdown column is the
          point: the related searches say what a trend is about without
          opening an article (Geno's screenshot, 2026-10-06). */}
      <section className="trends-panel" aria-label="Trending on Google">
        <p className="trends-panel-kicker">Google Trending now · {placeName} · {windowWord}</p>
        {live.length === 0 ? (
          board.terms.length === 0 ? (
            <p className="trends-empty">Nothing yet — Google is not answering and the archive is empty.</p>
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
                    {term.news[0] && (
                      <a href={term.news[0].url} target="_blank" rel="noreferrer">{term.news[0].title}</a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )
        ) : (
          <>
            <ol className="trends-live">
              {live.slice(0, shown).map((trend) => (
                <li key={trend.term} className="trends-live-row">
                  <span className="trends-live-main">
                    <a
                      className="trends-live-term"
                      href={`https://www.google.com/search?q=${encodeURIComponent(trend.term)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {trend.term}
                    </a>
                    <span className="trends-live-figures">
                      {trend.volume !== null && <b>{volumeLabel(trend.volume)}</b>}
                      {trend.pct !== null && <em>+{trend.pct.toLocaleString('en-US')}%</em>}
                      {trend.started !== null && <span>{startedLabel(trend.started)}</span>}
                    </span>
                  </span>
                  {trend.breakdown.length > 0 && (
                    <span className="trends-breakdown" title={trend.breakdown.join(' · ')}>
                      {trend.breakdown.slice(0, 4).map((piece) => (
                        <span key={piece} className="trends-breakdown-chip">{piece}</span>
                      ))}
                      {trend.breakdown.length > 4 && (
                        <span className="trends-breakdown-more">+{trend.breakdown.length - 4} more</span>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {live.length > shown && (
              <button type="button" className="trends-more" onClick={() => setShown((count) => count + LIVE_PAGE * 2)}>
                Show more · {Math.min(live.length - shown, LIVE_PAGE * 2)} of {(live.length - shown).toLocaleString('en-US')} left
              </button>
            )}
          </>
        )}
      </section>

      <div className="trends-grid trends-grid-two">
        <section className="trends-panel" aria-label="Library breakouts">
          {/* Reels land with Friday's weekly pass, so these two panels hold
              their 7-day floor whatever the picker says. */}
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
