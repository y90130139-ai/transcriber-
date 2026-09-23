'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Run } from '@/lib/run'

/**
 * Her run: the reels that popped, and whether she has kept up.
 *
 * The one screen in the portal that exists to give something back rather than
 * to ask for something. Everything on it is hers and measured — plays, likes,
 * shares, which days she posted, her multiple of her own median — and nothing
 * on it is a number we cannot actually read (saves and watch-through are
 * Insights-only, so they are absent rather than estimated).
 *
 * A sheet rather than a page: she came from her week and goes straight back to
 * it, and a route change would cost her scroll position on the thing she was
 * actually doing.
 */
export default function RunSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [failed, setFailed] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/plan/${token}/run`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: Run) => { if (alive) setRun(body) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [token])

  // Escape closes, and the sheet takes focus when it opens so a screen reader
  // starts here rather than back at the top of her week.
  const close = useCallback(() => onClose(), [onClose])
  useEffect(() => {
    sheet.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  /** One card's width plus its gap, measured rather than assumed. */
  function nudge(direction: 1 | -1) {
    const rail = track.current
    if (!rail) return
    const card = rail.querySelector<HTMLElement>('.run-card')
    const step = card ? card.offsetWidth + 12 : rail.clientWidth * 0.8
    rail.scrollBy({ left: step * direction, behavior: 'smooth' })
  }

  return (
    <div className="run-scrim" role="dialog" aria-modal="true" aria-label="Your run">
      <div className="run-sheet" ref={sheet} tabIndex={-1}>
        <div className="run-head">
          <p className="run-eyebrow">
            Your run
            <b>{run ? weeksLine(run.weeks_unbroken) : 'Last 30 days'}</b>
          </p>
          <button type="button" className="run-close" onClick={close} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {failed && <p className="run-empty">Could not load your numbers just now. Pull down and try again.</p>}
        {!run && !failed && <p className="run-empty">Counting your reels…</p>}

        {run && (
          <>
            {run.empty_because && <p className="run-empty">{run.empty_because}</p>}

            {run.reels.length > 0 && (
              <>
                <dl className="run-figures">
                  <div>
                    <dt>plays</dt>
                    <dd>{compact(run.totals.plays)}</dd>
                  </div>
                  <div>
                    <dt>best reel</dt>
                    <dd data-hot={run.totals.best_multiple && run.totals.best_multiple >= 10 ? true : undefined}>
                      {run.totals.best_multiple ? `${round(run.totals.best_multiple)}×` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>likes</dt>
                    <dd>{compact(run.totals.likes)}</dd>
                  </div>
                </dl>

                <div className="run-rail" ref={track}>
                  {run.reels.map((reel) => (
                    <a
                      key={reel.post_id}
                      className="run-card"
                      href={reel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="run-still">
                        {reel.job_id ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={`/api/plan/${token}/thumb/${reel.job_id}`} alt="" loading="lazy" />
                        ) : (
                          <span className="run-still-blank" aria-hidden="true" />
                        )}
                        {reel.hot && (
                          <span className="run-flame">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 3c0 4-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-1-3s3 2 3 6a8 8 0 0 1-8 8 8 8 0 0 1-8-8c0-7 10-8 10-12z" />
                            </svg>
                            {round(reel.multiple)}×
                          </span>
                        )}
                      </span>
                      <b className="run-plays">{compact(reel.plays)}</b>
                      <span className="run-when">
                        {when(reel.posted_at)} · {compact(reel.likes ?? 0)} likes
                      </span>
                    </a>
                  ))}
                </div>

                <div className="run-nudge">
                  <button type="button" onClick={() => nudge(-1)} aria-label="Previous reel">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <button type="button" onClick={() => nudge(1)} aria-label="Next reel">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                  <span>swipe · tap one to watch it</span>
                </div>
              </>
            )}

            <section className="run-kept">
              <h2>Kept up</h2>
              <div className="run-days">
                {run.week.days.map((day, index) => (
                  <span key={index} data-on={day.posted || undefined}>{day.letter}</span>
                ))}
              </div>
              <p className="run-said">{keptLine(run)}</p>
              {run.median_plays !== null && (
                <p className="run-said run-quiet">
                  Your normal reel does <b>{compact(run.median_plays)}</b> plays.
                  Anything past <b>{compact(run.median_plays * 10)}</b> is a winner — and winners
                  come back to you as cards.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/** "3 weeks unbroken", and the honest version when there is no streak yet. */
function weeksLine(weeks: number): string {
  if (weeks <= 0) return 'Last 30 days'
  if (weeks === 1) return 'This week, going'
  return `${weeks} weeks unbroken`
}

/** The nudge is always the next thing to do, never the thing she missed. */
function keptLine(run: Run): string {
  const on = run.week.days.filter((day) => day.posted).length
  const stories = run.week.story_days
  if (on >= 7) return 'Every day this week. Nothing to add — keep it exactly there.'
  if (on === 0) return 'Nothing up in the last seven days. One reel today starts it again.'
  const missing = 7 - on
  return `${on} of the last 7 days. ${missing === 1 ? 'One more day' : `${missing} more days`}`
    + ` completes the week${stories > 0 ? `, and stories are up on ${stories} of them` : ''}.`
}

function round(value: number): number {
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
}

/** 412,000 → 412k. Her numbers get big, and the strip is 216px wide. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return value.toLocaleString('en-US')
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}
