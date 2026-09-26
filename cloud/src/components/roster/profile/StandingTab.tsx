'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/dates'
import {
  FIRE_AT, COLD_BELOW, HEAT_MARK, SITUATION_LABEL, isCleared,
  type Priority, type RevenueBand,
} from '@/lib/engagement'
import type { Standing } from '@/lib/standing'
import TrendChip from '../TrendChip'
import TrendLine from '../TrendLine'

const PRIORITIES: Priority[] = ['S', 'A', 'B', 'C']
const BANDS: { key: RevenueBand; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'mid', label: 'Mid' },
  { key: 'low', label: 'Low' },
]
const HEAT_LABEL = { fire: 'On fire', cold: 'Cold', steady: 'Steady', new: 'Too early to read' }
const PARTS: { key: 'filmed' | 'answered' | 'posted' | 'opened' | 'talked'; label: string }[] = [
  { key: 'filmed', label: 'Filmed what they took on' },
  { key: 'answered', label: 'Answered every card' },
  { key: 'posted', label: 'Posted (bound by you)' },
  { key: 'opened', label: 'Opened, and how fast' },
  { key: 'talked', label: 'Talked to you' },
]

/** Days since an instant, as words. */
function ago(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'in the last 24 hours'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

/**
 * Her standing: how she is responding to plans, and where she sits in the
 * order of who gets attention. Saves as it is tapped — a priority is a
 * decision, not a field waiting for the profile's Save.
 */
export default function StandingTab({
  modelId,
  onChanged,
}: {
  modelId: string
  onChanged?: () => void
}) {
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
    if (!response.ok) {
      setError(body.error ?? 'That did not save.')
      return
    }
    setStanding(body.standing ?? null)
    onChanged?.()
  }

  if (!standing) return <p className="hint">{error ?? 'Reading their weeks…'}</p>

  const { engagement, suggestion } = standing
  const mark = HEAT_MARK[engagement.heat]

  return (
    <div className="standingtab">
      <section className="standing-heat" data-heat={engagement.heat}>
        <p className="standing-heat-head">
          {mark && <span aria-hidden="true">{mark} </span>}
          {HEAT_LABEL[engagement.heat]}
          {engagement.score !== null && <b> · {engagement.score}</b>}
        </p>
        <p className="hint">{engagement.why}. Last active {ago(standing.last_active)}.</p>
        {standing.trend ? (
          <>
            <p className="standing-trend">
              <TrendChip trend={standing.trend} variant="inline" />
              <span>
                {standing.trend.previous} → {standing.trend.previous + standing.trend.delta} since their previous sent week
              </span>
            </p>
            <TrendLine trend={standing.trend} />
          </>
        ) : (
          <p className="hint">A trend appears once they have two sent weeks.</p>
        )}
        {standing.backlog > 0 && (
          <p className="hint">
            {standing.backlog} card{standing.backlog === 1 ? '' : 's'} carried from an earlier
            week and still not filmed.
          </p>
        )}
      </section>

      <div className="form-row">
        <span className="axis-name">Revenue — a band, never a figure</span>
        <div className="daypicker" role="group" aria-label="Revenue band">
          {BANDS.map((band) => (
            <button
              key={band.key}
              className="chip"
              disabled={busy}
              data-on={standing.revenue_band === band.key}
              aria-pressed={standing.revenue_band === band.key}
              onClick={() => save({ revenue_band: standing.revenue_band === band.key ? null : band.key })}
            >
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <span className="axis-name">Priority — who gets attention first</span>
        <div className="daypicker" role="group" aria-label="Priority">
          {PRIORITIES.map((letter) => (
            <button
              key={letter}
              className="chip"
              disabled={busy}
              data-on={standing.priority === letter}
              data-suggested={suggestion.priority === letter && standing.priority !== letter ? 'true' : undefined}
              aria-pressed={standing.priority === letter}
              onClick={() => save({ priority: standing.priority === letter ? null : letter })}
            >
              {letter}
            </button>
          ))}
        </div>
        <p className="hint">
          {suggestion.priority
            ? <>
                Suggested <b>{suggestion.priority}</b>
                {standing.previous_suggestion && standing.previous_suggestion !== suggestion.priority && (
                  <> (was {standing.previous_suggestion} a week ago)</>
                )}
                {' '}· {SITUATION_LABEL[suggestion.situation]} — {suggestion.why}.
              </>
            : suggestion.why + '.'}
          {standing.priority && standing.priority_set_at && ` Set ${ago(standing.priority_set_at)}.`}
        </p>
        {suggestion.priority && suggestion.priority !== standing.priority && (
          <button className="btn btn-small" disabled={busy} onClick={() => save({ priority: suggestion.priority })}>
            Use {suggestion.priority}
          </button>
        )}
      </div>

      {engagement.parts && (
        <div className="form-row">
          <span className="axis-name">What the score is made of · last {engagement.weeks} sent week{engagement.weeks === 1 ? '' : 's'}</span>
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
          <p className="hint">
            🔥 at {FIRE_AT} or a cleared week · 🧊 under {COLD_BELOW}, or a sent week unopened for 3 days.
            Drafts never count, and a turned-down card is an answer, not a miss.
          </p>
        </div>
      )}

      {standing.weeks.length > 0 && (
        <div className="form-row">
          <span className="axis-name">Their sent weeks</span>
          <ul className="standing-weeks">
            {standing.weeks.map((week) => (
              <li key={week.week_of} data-cleared={isCleared(week) || undefined}>
                <b>{formatDate(week.week_of)}</b>
                <span>{week.opened_at ? 'opened' : 'not opened'}</span>
                <span>{week.accepted + week.declined}/{week.items} answered</span>
                <span>{week.filmed}/{Math.max(0, week.items - week.declined)} filmed{isCleared(week) ? ' 🔥' : ''}</span>
                {week.posted > 0 && <span>{week.posted} posted</span>}
                {week.messages > 0 && <span>{week.messages} message{week.messages === 1 ? '' : 's'}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="hint" role="alert">{error}</p>}
    </div>
  )
}
