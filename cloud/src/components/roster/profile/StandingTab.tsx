'use client'

import { useCallback, useEffect, useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import {
  FIRE_AT, COLD_BELOW, HEAT_MARK, isCleared,
  type Priority, type RevenueBand,
} from '@/lib/engagement'
import type { Standing } from '@/lib/standing'
import TrendChip from '../TrendChip'
import TrendLine from '../TrendLine'

/**
 * What the Heat tab held, split three ways (Geno, 2026-09-27: "combine these,
 * don't take up so much space"):
 *
 *   StandingControls  priority and revenue as chips in her profile header
 *   StandingCard      the engagement score, in plain words, on Analytics
 *   SentWeeks         her sent weeks and when the next is due, on Reels
 *
 * All three read and write `/api/models/<id>/standing` through `useStanding`.
 */

const PRIORITIES: Priority[] = ['S', 'A', 'B', 'C']
const BANDS: { key: RevenueBand; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'mid', label: 'Mid' },
  { key: 'low', label: 'Low' },
]
const HEAT_LABEL = { fire: 'On fire', cold: 'Going cold', steady: 'Steady', new: 'Too early to tell' }
const PARTS: { key: 'filmed' | 'answered' | 'posted' | 'opened' | 'talked'; label: string }[] = [
  { key: 'filmed', label: 'Filmed what they said yes to' },
  { key: 'answered', label: 'Answered every card' },
  { key: 'posted', label: 'Posted the videos' },
  { key: 'opened', label: 'Opened the plan quickly' },
  { key: 'talked', label: 'Talked to us' },
]

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function useStanding(modelId: string, onChanged?: () => void) {
  const [standing, setStanding] = useState<Standing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/standing`)
    if (response.ok) setStanding((await response.json()).standing ?? null)
    else setError('Their standing did not load.')
  }, [modelId])

  useEffect(() => { void load() }, [load])

  async function save(patch: { priority?: Priority | null; revenue_band?: RevenueBand | null }) {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/models/${modelId}/standing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) return setError(body.error ?? 'That did not save.')
    setStanding(body.standing ?? null)
    onChanged?.()
  }

  return { standing, busy, error, save }
}

/** Priority and revenue, tappable, in the header beside her name. */
export function StandingControls({ modelId, onChanged }: { modelId: string; onChanged?: () => void }) {
  const { standing, busy, error, save } = useStanding(modelId, onChanged)
  if (!standing) return null
  const suggested = standing.suggestion.priority
  return (
    <div className="head-controls">
      <span className="head-control" role="group" aria-label="Priority">
        <small>Priority</small>
        {PRIORITIES.map((letter) => (
          <button key={letter} type="button" className="head-chip" disabled={busy}
            data-on={standing.priority === letter}
            data-suggested={suggested === letter && standing.priority !== letter ? 'true' : undefined}
            title={suggested === letter && standing.priority !== letter ? `Suggested: ${letter}` : undefined}
            onClick={() => void save({ priority: standing.priority === letter ? null : letter })}>
            {letter}
          </button>
        ))}
      </span>
      <span className="head-control" role="group" aria-label="Revenue">
        <small>Revenue</small>
        {BANDS.map((band) => (
          <button key={band.key} type="button" className="head-chip" disabled={busy}
            data-on={standing.revenue_band === band.key}
            onClick={() => void save({ revenue_band: standing.revenue_band === band.key ? null : band.key })}>
            {band.label}
          </button>
        ))}
      </span>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}

/** How they are doing with their plans — the old Heat tab's scorecard. */
export function StandingCard({ modelId }: { modelId: string }) {
  const { standing } = useStanding(modelId)
  if (!standing) return <section className="dash-panel standing-card"><p className="hint">Reading their weeks…</p></section>
  const { engagement } = standing
  const mark = HEAT_MARK[engagement.heat]
  return (
    <section className="dash-panel standing-card" data-heat={engagement.heat} aria-labelledby="standing-h">
      <header className="dash-panel-head">
        <h2 id="standing-h">
          {mark && <span aria-hidden>{mark} </span>}{HEAT_LABEL[engagement.heat]}
          {engagement.score !== null && <span className="standing-score">{engagement.score}<small>/100</small></span>}
        </h2>
        <p>How they&rsquo;re doing with their plans · active {ago(standing.last_active)}</p>
      </header>
      {engagement.parts ? (
        <ul className="standing-parts">
          {PARTS.map((part) => {
            const value = Math.round((engagement.parts?.[part.key] ?? 0) * 100)
            return (
              <li key={part.key}>
                <span>{part.label}</span>
                <span className="standing-bar" aria-hidden="true"><i style={{ width: `${value}%` }} /></span>
                <b>{value}%</b>
              </li>
            )
          })}
        </ul>
      ) : <p className="hint">Nothing to score until they have a sent week.</p>}
      {standing.trend ? (
        <div className="standing-trend">
          <TrendChip trend={standing.trend} variant="inline" />
          <span>{standing.trend.previous} → {standing.trend.previous + standing.trend.delta} since last week</span>
          <TrendLine trend={standing.trend} />
        </div>
      ) : (
        <p className="hint">
          {engagement.weeks <= 1 ? 'Only one sent week so far — the trend shows after their second.' : ''}
        </p>
      )}
      {standing.backlog > 0 && (
        <p className="hint">{standing.backlog} card{standing.backlog === 1 ? '' : 's'} from earlier weeks still not filmed.</p>
      )}
      <p className="hint">🔥 {FIRE_AT}+ or a fully filmed week · 🧊 under {COLD_BELOW}, or a plan left unopened 3 days.</p>
    </section>
  )
}

/** Their sent weeks, newest first, and when the next one is due. */
export function SentWeeks({ modelId }: { modelId: string }) {
  const { standing } = useStanding(modelId)
  if (!standing || standing.weeks.length === 0) return null
  const latest = standing.weeks[0]
  const next = addDays(latest.week_of, 7)
  const overdue = next < currentWeekOf()
  return (
    <section className="sent-weeks" aria-labelledby="sent-weeks-h">
      <header>
        <h3 id="sent-weeks-h">Plans sent</h3>
        <p>
          Last: week of <b>{formatDate(latest.week_of)}</b> ·{' '}
          {overdue
            ? <b className="sent-overdue">next is overdue — send this week&rsquo;s</b>
            : <>next due: week of <b>{formatDate(next)}</b></>}
        </p>
      </header>
      <ul className="standing-weeks">
        {standing.weeks.map((week) => (
          <li key={week.week_of} data-cleared={isCleared(week) || undefined}>
            <b>{formatDate(week.week_of)}</b>
            <span>{week.opened_at ? 'opened' : 'not opened'}</span>
            <span>{week.accepted + week.declined}/{week.items} answered</span>
            <span>{week.filmed}/{Math.max(0, week.items - week.declined)} filmed{isCleared(week) ? ' 🔥' : ''}</span>
            {week.posted > 0 && <span>{week.posted} posted</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
