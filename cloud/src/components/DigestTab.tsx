'use client'

import { useEffect, useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import { thumbUrl } from '@/lib/format'
import type { Count, Digest } from '@/lib/digest'
import LineChart from './dashboard/LineChart'
import WhyChips from './WhyChips'

const PATTERNS: { key: keyof Digest['common']; name: string }[] = [
  { key: 'reasons', name: 'What carried them' },
  { key: 'formats', name: 'Format' },
  { key: 'hooks', name: 'Opening' },
  { key: 'sounds', name: 'Sound' },
  { key: 'personas', name: 'Persona' },
  { key: 'creators', name: 'Who' },
]

/** The week's winners in the niche, and what the best of them had in common.
 *  Read-only; it is the library, grouped by the week the reels went up. */
export default function DigestTab({ onFilterTo }: { onFilterTo: (handle: string) => void }) {
  const thisWeek = currentWeekOf()
  const [week, setWeek] = useState(thisWeek)
  const [digest, setDigest] = useState<Digest | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setDigest(null)
    setFailed(false)
    void (async () => {
      const response = await fetch(`/api/digest?week=${week}`)
      if (!live) return
      if (!response.ok) return setFailed(true)
      setDigest(await response.json())
    })()
    return () => { live = false }
  }, [week])

  const best = digest?.top[0] ?? null
  const topMultiple = best ? (best.why?.multiple ?? best.outperformance) : null

  return (
    <div className="dash">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title" id="digest-heading">The week</h2>
          <p className="dash-sub">{formatDate(week)} – {formatDate(addDays(week, 6))}</p>
        </div>
        <div className="dash-head-tools">
          <nav className="digest-nav" aria-label="Choose a week">
            <button className="pill" onClick={() => setWeek(addDays(week, -7))}>← Earlier</button>
            <button className="pill" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>
              Later →
            </button>
          </nav>
        </div>
      </header>

      {failed && <p className="hint" data-tone="bad">The digest could not be read. Try again in a moment.</p>}
      {!digest && !failed && <p className="hint">Reading the week…</p>}

      {digest && (
        <>
          <section className="dash-stats wk-stats" aria-label="The week in numbers">
            <article className="dash-stat dash-stat-lead">
              <h3>Winners · this week</h3>
              <p className="dash-stat-value">{digest.winners}</p>
              <p className="dash-stat-note">2× their own median or better</p>
            </article>
            <article className="dash-stat">
              <h3>Posted</h3>
              <p className="dash-stat-value">{digest.posted}</p>
              <p className="dash-stat-note">in the library that week</p>
            </article>
            {topMultiple !== null && (
              <article className="dash-stat">
                <h3>Best multiple</h3>
                <p className="dash-stat-value">{times(topMultiple)}</p>
                <p className="dash-stat-note">{best?.author ? `@${best.author}` : 'their own median'}</p>
              </article>
            )}
          </section>

          {(digest.daily?.length ?? 0) > 0 && (
            <section className="dash-panel" aria-labelledby="wk-daily-h">
              <header className="dash-panel-head">
                <h2 id="wk-daily-h">The week, day by day</h2>
                <p>Everything that went up, and which of it popped. A winner is 2× their own median.</p>
              </header>
              <LineChart
                series={(digest.daily ?? []).map((d) => ({ day: d.day, value: d.posted }))}
                previous={(digest.daily ?? []).map((d) => ({ day: d.day, value: d.winners }))}
                legend={{ now: 'Posted', prev: 'Winners' }}
                label="Posted and winners by day"
                emptyNote="Nothing in the library for this week."
              />
            </section>
          )}

          {digest.basis > 0 && (
            <section className="dash-panel" aria-labelledby="wk-pat-h">
              <header className="dash-panel-head">
                <h2 id="wk-pat-h">What carried the winners</h2>
                <p>
                  {digest.basis < digest.winners
                    ? `Counted over the strongest ${digest.basis}`
                    : `Across all ${digest.winners} winners`}
                </p>
              </header>
              <div className="wk-patterns">
                {PATTERNS.map(({ key, name }) => (
                  <PatternBars key={key} name={name} rows={digest.common[key]} of={digest.basis}
                    onPick={key === 'creators' ? (row) => onFilterTo(row.key) : undefined} />
                ))}
              </div>
            </section>
          )}

          {digest.top.length > 0 && (
            <>
              <div className="section-head">
                <h2>Top {digest.top.length}</h2>
              </div>
              <ol className="wk-list">
                {digest.top.map((item, index) => {
                  const rank = index + 1
                  const body = (
                    <>
                      <span className="wk-n">{rank}</span>
                      <span className="wk-thumb">
                        {item.has_thumb
                          ? <img src={thumbUrl(item.id)} alt="" width={120} height={150} loading="lazy" />
                          : <span className="wk-blank" aria-hidden />}
                      </span>
                      <span className="wk-main">
                        <span className="wk-top">
                          <span className="wk-who">{item.author ? `@${item.author}` : 'Unknown'}</span>
                          {item.upload_date && <span className="wk-date">{item.upload_date}</span>}
                        </span>
                        {item.preview && <span className="wk-line">{item.preview}</span>}
                        <WhyChips why={item.why} />
                      </span>
                      <span className="wk-fig">{times(item.why?.multiple ?? item.outperformance)}</span>
                    </>
                  )
                  return (
                    <li key={item.id} data-rank={rank <= 3 ? rank : undefined}>
                      {item.webpage_url
                        ? <a className="wk-row" href={item.webpage_url} target="_blank" rel="noreferrer">{body}</a>
                        : <span className="wk-row">{body}</span>}
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** 554.05 → 554×, 3.93 → 3.9× — a multiple is scanned, not read. */
function times(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}×`
}

/** One axis of the winners' common ground, ranked: label, count, then a
 *  meter measured against the axis's own leader. Clickable where there is
 *  somewhere to go (the creators, into the Library). */
function PatternBars({
  name, rows, of, onPick,
}: {
  name: string
  rows: Count[]
  of: number
  onPick?: (row: Count) => void
}) {
  if (rows.length === 0) return null
  const max = Math.max(...rows.map((row) => row.n), 1)
  return (
    <div className="wk-pat">
      <h3 className="wk-pat-name">{name}</h3>
      <ul className="wk-pat-rows">
        {rows.map((row) => {
          const inner = (
            <>
              <span className="wk-pat-label">{row.label}</span>
              <span className="wk-pat-n">{row.n}/{of}</span>
              <span className="wk-pat-meter" aria-hidden><i style={{ width: `${Math.round((row.n / max) * 100)}%` }} /></span>
            </>
          )
          return (
            <li key={row.key}>
              {onPick
                ? <button type="button" className="wk-pat-row" onClick={() => onPick(row)} title="See them in the Library">{inner}</button>
                : <span className="wk-pat-row">{inner}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
