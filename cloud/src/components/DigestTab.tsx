'use client'

import { useEffect, useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import { ago, compact, thumbUrl } from '@/lib/format'
import { reasonChip } from '@/lib/reasons'
import type { Count, Digest } from '@/lib/digest'
import { Icon } from '@/components/console/ConsoleIcons'
import {
  CommentGlyph, DownloadGlyph, HeartGlyph, OpenGlyph, PlayGlyph,
} from '@/components/platform/glyphs'
import LineChart from './dashboard/LineChart'

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
              {/* The week's reels wear the platform feeds' card, exactly
                  (2026-10-07): age and the lead reason as the top chips, the
                  handle and date on the floor, plays/likes/comments as the
                  stat pills. No numeral on the card — the order is the rank,
                  and the ember score is the multiple that earned it. */}
              <ol className="pl-grid wk-rack">
                {digest.top.map((item) => {
                  const multiple = item.why?.multiple ?? item.outperformance
                  const lead = item.why?.reasons[0] ?? null
                  const href = item.webpage_url ?? '#'
                  return (
                    <li key={item.id}>
                      <article className="pl-card">
                        <div className="pl-frame">
                          {item.has_thumb
                            ? <img className="pl-poster" src={thumbUrl(item.id)} alt="" width={420} height={525}
                                loading="lazy" decoding="async" />
                            : <span className="wk-blank" aria-hidden />}
                          <span className="pl-scrim" aria-hidden />
                          <a className="pl-open" href={href} target="_blank" rel="noreferrer"
                            aria-label={item.author ? `Open @${item.author}'s reel` : 'Open the reel'}
                            title={item.preview ?? undefined} />
                          <span className="pl-topline">
                            <span className="pl-when">
                              <Icon name="calendar" size={12} />
                              {ago(item.upload_date)}
                            </span>
                            {lead && <span className="pl-tag">{reasonChip(lead)}</span>}
                          </span>
                          <span className="pl-tools">
                            <a className="pl-tool" href={thumbUrl(item.id)} target="_blank" rel="noreferrer"
                              title="Open the thumbnail">
                              <DownloadGlyph />
                            </a>
                            <a className="pl-tool" href={href} target="_blank" rel="noreferrer" title="Open the reel">
                              <OpenGlyph />
                            </a>
                          </span>
                          <span className="pl-foot">
                            <span className="pl-user">{item.author ? `@${item.author}` : 'Unknown'}</span>
                            {item.upload_date && <span className="pl-subline">{shortDate(item.upload_date)}</span>}
                            {multiple != null && <span className="pl-score">{times(multiple)}</span>}
                          </span>
                          <span className="pl-stats">
                            {item.plays !== null && (
                              <span className="pl-stat" title={`${item.plays.toLocaleString()} plays`}>
                                <PlayGlyph />{compact(item.plays)}
                              </span>
                            )}
                            {item.likes !== null && (
                              <span className="pl-stat" title={`${item.likes.toLocaleString()} likes`}>
                                <HeartGlyph />{compact(item.likes)}
                              </span>
                            )}
                            {item.comments !== null && (
                              <span className="pl-stat" title={`${item.comments.toLocaleString()} comments`}>
                                <CommentGlyph />{compact(item.comments)}
                              </span>
                            )}
                          </span>
                        </div>
                      </article>
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

/** 2026-09-29 → "29 Sep" — the week's line under the handle. */
function shortDate(iso: string): string {
  const at = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
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
