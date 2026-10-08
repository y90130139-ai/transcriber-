'use client'

/**
 * Trends — the Discovery page, round four (Geno, 2026-10-08: "like Google
 * Trends, in our own colours"), flattened the same day: one ground, no
 * panels, no card borders, no graph behind the hero. The hero asks what
 * the place is searching for; the live list sits below as plain rows;
 * search a term — or tap a row — and the interest graph pulls up, with
 * "a vs b" comparisons. The graph's window picker is Google's (24 h /
 * 7 days / 30 days / 12 months / 5 years). Under it all: the Trends AI
 * box grounded in the board, then the library's own breakouts and sounds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  INTEREST_RANGES,
  parseInterestQuery,
  sparkPoints,
  startedLabel,
  TREND_RANGES,
  US_GEOS,
  volumeLabel,
  type Direction,
  type InterestPoint,
  type InterestRange,
  type LiveTrend,
  type TrendRange,
  type TrendsBoard,
} from '@/lib/trends-feed'
import TrendsChart, { SERIES_COLORS } from './TrendsChart'
import DropSelect from './dashboard/DropSelect'
import { OpenGlyph, PlayGlyph } from './platform/glyphs'

type Exchange = { question: string; answer?: string; error?: string }
type LiveSort = 'relevance' | 'volume' | 'recent'

const RANGE_LABEL: Record<TrendRange, string> = { 1: '24 h', 2: '48 h', 3: '3 days', 7: '7 days' }

/** Rows on screen before "Show more" — the whole list stays exportable. */
const LIVE_PAGE = 30

const SPARK_W = 72
const SPARK_H = 20

function compact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** The one search box does both jobs (Geno, 2026-10-08: "integrate this into
 *  the search"): a term — or "a vs b" — draws the interest graph, a question
 *  goes to Trends AI. A question is one that ends in "?" or opens with a
 *  question word; "guardians vs white sox" is never one. */
const QUESTION_OPEN = /^(what|which|who|when|where|why|how|any|is|are|can|could|should|would|do|does|did|will|tell)\b/i

function looksLikeQuestion(text: string): boolean {
  const asked = text.trim()
  return asked.endsWith('?') || QUESTION_OPEN.test(asked)
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
  const [thread, setThread] = useState<Exchange[]>([])
  const [asking, setAsking] = useState(false)

  // The search half: the terms on the graph, its window, and the answer.
  const [query, setQuery] = useState('')
  const [terms, setTerms] = useState<string[]>([])
  const [interestRange, setInterestRange] = useState<InterestRange>('now 7-d')
  const [interest, setInterest] = useState<{ loading: boolean; error: string | null; points: InterestPoint[] }>(
    { loading: false, error: null, points: [] },
  )
  const chartRef = useRef<HTMLElement>(null)

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

  const loadInterest = useCallback(async (wantTerms: string[], wantRange: InterestRange, wantGeo: string) => {
    setInterest({ loading: true, error: null, points: [] })
    const params = new URLSearchParams({ geo: wantGeo, range: wantRange })
    for (const term of wantTerms) params.append('term', term)
    const response = await fetch(`/api/trends/interest?${params}`).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (!response?.ok || !Array.isArray(body?.points)) {
      setInterest({ loading: false, error: 'Google would not draw that one — wait a beat and try again.', points: [] })
      return
    }
    setInterest({ loading: false, error: null, points: body.points as InterestPoint[] })
  }, [])

  // One fetch path: a new search, a dropped term, a new window, a new place.
  useEffect(() => {
    if (terms.length > 0) void loadInterest(terms, interestRange, geo)
  }, [terms, interestRange, geo, loadInterest])

  // The chart only exists once there is something to draw, so the scroll
  // waits for it to mount. Only an explore asks for it — dropping a term
  // must not throw the page down again.
  const wantChart = useRef(false)
  useEffect(() => {
    if (!wantChart.current || terms.length === 0) return
    wantChart.current = false
    chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [terms])

  const live = useMemo(() => {
    const rows = board?.live ?? []
    if (sort === 'volume') return [...rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || (b.pct ?? 0) - (a.pct ?? 0))
    if (sort === 'recent') return [...rows].sort((a, b) => (b.started ?? 0) - (a.started ?? 0))
    return rows // relevance — Google's own order
  }, [board, sort])

  const averages = useMemo(
    () => terms.map((_, series) => {
      const values = interest.points.map((point) => point.v[series] ?? 0)
      return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
    }),
    [terms, interest.points],
  )

  function explore(text: string) {
    const found = parseInterestQuery(text)
    if (found.length === 0) return
    setQuery(text.trim())
    wantChart.current = true
    setTerms(found)
  }

  function dropTerm(term: string) {
    setTerms((current) => current.filter((entry) => entry !== term))
  }

  /** The hero search's one door: a question asks Trends AI, anything else is
   *  a term to graph. */
  function submitSearch(text: string) {
    const asked = text.trim()
    if (!asked) return
    if (looksLikeQuestion(asked)) void ask(asked)
    else explore(asked)
  }

  async function ask(text: string) {
    const asked = text.trim()
    if (!asked || asking) return
    setAsking(true)
    setThread((current) => [...current, { question: asked }])
    const response = await fetch('/api/trends/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: asked, days, geo }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setThread((current) => current.map((entry, index) => {
      if (index !== current.length - 1) return entry
      if (!response?.ok || !body?.answer) return { ...entry, error: body?.error ?? 'No answer came back — try again.' }
      return { ...entry, answer: String(body.answer) }
    }))
    setAsking(false)
  }

  if (failed) return <p className="trends-empty">The board would not load — reload the page.</p>
  if (!board) return null

  const placeName = US_GEOS.find((g) => g.code === geo)?.name ?? 'United States'
  const placeWord = geo === 'US' ? 'the United States' : placeName
  const windowWord = days === 1 ? 'the past 24 hours' : `the past ${RANGE_LABEL[days]}`
  const hints = live.slice(0, 3)

  return (
    <div className="trends">
      {/* The hero: Google Trends' own question, in the console's clothes.
          Type, search, hints — nothing behind it. */}
      <section className="trends-hero" aria-label="Search interest">
        <div className="trends-hero-inner">
          <p className="trends-kicker">Discovery</p>
          <h1 className="trends-hero-title">
            Explore what <mark className="trends-place">{placeWord}</mark> is searching for right now
          </h1>
          <form
            className="trends-search"
            onSubmit={(event) => { event.preventDefault(); submitSearch(query) }}
          >
            <span className="trends-search-dot" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a term — or ask a question · compare with “vs”"
              aria-label="Search interest, or ask Trends AI"
              maxLength={500}
            />
            <button type="submit" disabled={!query.trim() || asking}>
              {asking ? 'Asking…' : looksLikeQuestion(query) ? 'Ask' : 'Explore'}
            </button>
          </form>
          {hints.length > 0 && (
            <div className="trends-hero-hints">
              <span className="trends-hint-note">Trending right now</span>
              {hints.map((trend) => (
                <button key={trend.term} type="button" className="trends-hint" onClick={() => explore(trend.term)}>
                  {trend.term}
                </button>
              ))}
            </div>
          )}

          {/* The answers land in the hero, right under the box that asked
              (Geno, 2026-10-08: "integrate Trends AI into the search bar").
              Each shows its working — the data the answer was built on. */}
          {thread.length > 0 && (
            <div className="trends-answers" aria-live="polite">
              {thread.map((entry, index) => (
                <div key={index} className="trends-answer">
                  <p className="trends-answer-q">{entry.question}</p>
                  {entry.answer
                    ? <p className="trends-answer-a">{entry.answer}</p>
                    : entry.error
                      ? <p className="trends-answer-a trends-answer-error">{entry.error}</p>
                      : <p className="trends-answer-a trends-answer-waiting">Reading the board…</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* The graph, once there is one to draw. The range picker is the
          graph's own, the way Google Trends' is. */}
      {terms.length > 0 && (
        <section className="trends-chart" ref={chartRef} aria-label="Interest over time">
          <header className="trends-chart-head">
            <div className="trends-chart-titles">
              <p className="trends-panel-kicker">Interest over time · {placeName}</p>
              <div className="trends-legend">
                {terms.map((term, series) => (
                  <span key={term} className="trends-legend-item">
                    <i aria-hidden style={{ background: SERIES_COLORS[series] }} />
                    <b>{term}</b>
                    {interest.points.length > 0 && <span className="trends-legend-avg">avg {averages[series]}</span>}
                    {terms.length > 1 && (
                      <button type="button" className="trends-legend-drop"
                        onClick={() => dropTerm(term)} aria-label={`Remove ${term} from the comparison`}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <nav className="trends-ranges" aria-label="Graph window">
              {INTEREST_RANGES.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  className="trends-range"
                  data-on={interestRange === range.id || undefined}
                  aria-pressed={interestRange === range.id}
                  onClick={() => setInterestRange(range.id)}
                >
                  {range.label}
                </button>
              ))}
            </nav>
          </header>
          <TrendsChart
            terms={terms}
            points={interest.points}
            range={interestRange}
            loading={interest.loading}
            error={interest.error}
            onRetry={() => void loadInterest(terms, interestRange, geo)}
          />
          <p className="trends-chart-foot">
            Relative search interest, 0–100 against the window’s peak · times in UTC · Google Trends
          </p>
        </section>
      )}

      {/* Google's own Trending Now, as plain rows: the figures and the
          breakdown say what each trend is; a tap draws its graph above. */}
      <section className="trends-panel" aria-label="Trending on Google">
        <header className="trends-sec-head">
          <div>
            <p className="trends-panel-kicker">
              <i className="trends-live-dot" aria-hidden />
              Trending now · {placeName} · {windowWord}
            </p>
            <h2 className="trends-sec-title">
              {live.length > 0
                ? <><b className="trends-sec-count">{live.length.toLocaleString('en-US')}</b> searches climbing right now</>
                : 'Google is not answering — showing the daily archive'}
            </h2>
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
              <DropSelect
                value={geo}
                onChange={setGeo}
                label="Place"
                options={US_GEOS.map((place) => ({ value: place.code, label: place.name }))}
              />
              <DropSelect
                value={sort}
                onChange={(next) => setSort(next as LiveSort)}
                label="Order"
                options={[
                  { value: 'relevance', label: 'By relevance' },
                  { value: 'volume', label: 'By search volume' },
                  { value: 'recent', label: 'Newest first' },
                ]}
              />
              {live.length > 0 && (
                <button type="button" className="trends-pull" onClick={() => exportCsv(live, geo, days)}>
                  Export CSV
                </button>
              )}
            </div>
          </div>
        </header>

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
            <div className="trends-table-frame">
              <div className="trends-table-scroll">
                <table className="dash-table trends-table">
                  <thead>
                    <tr>
                      <th scope="col" className="trends-table-rank">#</th>
                      <th scope="col">Search</th>
                      <th scope="col">Related searches</th>
                      <th scope="col" className="num">Volume</th>
                      <th scope="col" className="num">Jump</th>
                      <th scope="col">Started</th>
                      <th scope="col">
                        <span aria-hidden="true">↗</span>
                        <span className="trends-table-sr">Open on Google</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.slice(0, shown).map((trend, index) => (
                      <tr
                        key={trend.term}
                        tabIndex={0}
                        title={`Draw the interest graph for “${trend.term}”`}
                        onClick={() => explore(trend.term)}
                        onKeyDown={(event) => { if (event.key === 'Enter') explore(trend.term) }}
                      >
                        <td className="trends-table-rank">{String(index + 1).padStart(2, '0')}</td>
                        <th scope="row" className="trends-table-term">{trend.term}</th>
                        <td className="trends-table-related">
                          {trend.breakdown.length > 0
                            ? (
                              <span>
                                {trend.breakdown.slice(0, 4).join(' · ')}
                                {trend.breakdown.length > 4 ? ` +${trend.breakdown.length - 4}` : ''}
                              </span>
                            )
                            : <span className="trends-table-none">—</span>}
                        </td>
                        <td className="num trends-table-volume">
                          {trend.volume !== null ? volumeLabel(trend.volume) : '—'}
                        </td>
                        <td className="num trends-table-jump">
                          {trend.pct !== null ? `+${trend.pct.toLocaleString('en-US')}%` : '—'}
                        </td>
                        <td className="trends-table-when">
                          {trend.started !== null ? startedLabel(trend.started) : '—'}
                        </td>
                        <td className="trends-table-open">
                          <a
                            className="trends-trend-out"
                            href={`https://www.google.com/search?q=${encodeURIComponent(trend.term)}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Search ${trend.term} on Google`}
                            title="Open on Google"
                          >
                            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                              <path d="M3.5 2H10v6.5M10 2 2.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
          {/* The same card the /instagram feed wears (Geno, 2026-10-08): the
              9:16 frame, the age-free top line, the handle and the reason over
              the floor, the multiple where the score pill sits, plays in the
              stats stack. The caption is the open-link's tooltip, not a
              paragraph — one card per reel, scannable. */}
          {board.breakouts.length === 0 ? (
            <p className="trends-empty">No watched account beat its usual 2× in the window.</p>
          ) : (
            <div className="pl-grid">
              {board.breakouts.map((reel) => (
                <article className="pl-card" key={reel.post_id}>
                  <div className="pl-frame">
                    {reel.thumb_job ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="pl-poster" src={`/api/thumb/${reel.thumb_job}`} alt="" loading="lazy" />
                    ) : (
                      <div className="pl-blank"><span>Preview unavailable</span></div>
                    )}
                    <span className="pl-scrim" aria-hidden />
                    <a
                      className="pl-open"
                      href={reel.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open @${reel.handle}'s reel`}
                      title={reel.caption ?? undefined}
                    />
                    <span className="pl-tools">
                      <a className="pl-tool" href={reel.url ?? '#'} target="_blank" rel="noreferrer" title="Open the post">
                        <OpenGlyph />
                      </a>
                    </span>
                    <span className="pl-foot">
                      <span className="pl-user">@{reel.handle}</span>
                      <span className="pl-subline">{reel.audio_title ? `♪ ${reel.audio_title}` : 'Library reel'}</span>
                      <span className="pl-score" title={`${reel.multiple}× their usual`}>{reel.multiple}×</span>
                    </span>
                    <span className="pl-stats">
                      <span className="pl-stat" title={`${reel.plays.toLocaleString('en-US')} plays`}>
                        <PlayGlyph />{compact(reel.plays)}
                      </span>
                    </span>
                  </div>
                </article>
              ))}
            </div>
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
