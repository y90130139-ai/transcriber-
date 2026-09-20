'use client'

import { useEffect, useState } from 'react'
import { compact } from '@/lib/format'

type Meets = { reels: boolean | null; carousels: boolean | null; stories: boolean | null }
type Cadence = {
  window_days: number
  days_covered: number
  counts: { reel: number; carousel: number; photo: number; video: number }
  reels_per_day: number | null
  carousels_per_week: number | null
  story_days: number
  story_days_observed: number
  longest_gap_days: number | null
  last_posted_at: string | null
  meets: Meets
}
type Report = {
  target: { reelsPerDay: number; carouselsPerWeek: number; storyDaysPerWeek: number }
  cadence: Cadence
  growth: { readings: number; followers_now: number | null; followers_gained: number | null }
}

/** A verdict we have not earned yet reads as "not yet", never as a miss.
 *  Nothing here should accuse someone of missing a day nobody looked at. */
function verdict(met: boolean | null): { label: string; state: string } {
  if (met === null) return { label: 'not yet', state: 'unknown' }
  return met ? { label: 'on pace', state: 'yes' } : { label: 'behind', state: 'no' }
}

/** How an account is actually doing: what they post, how often, and whether a
 *  story went up. The same panel for a watched creator and for one of ours. */
export default function Scorecard({ handle }: { handle: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const response = await fetch(`/api/analytics/${encodeURIComponent(handle)}`)
      if (!live) return
      if (!response.ok) return setMissing(true)
      setReport(await response.json())
    })()
    return () => { live = false }
  }, [handle])

  if (missing) return null
  if (!report) return <div className="axis"><span className="hint">Reading the record…</span></div>

  const { cadence: pace, target, growth } = report
  const nothing = pace.days_covered === 0

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">How they are doing</span>
        <span className="hint">
          {nothing
            ? 'nothing swept yet'
            : `${pace.days_covered} day${pace.days_covered === 1 ? '' : 's'} of record`}
        </span>
      </div>

      {nothing ? (
        <span className="hint">
          The sweep has not reached this account yet. Rates appear once it has.
        </span>
      ) : (
        <>
          <div className="score-row">
            <Metric
              name="Reels a day"
              value={pace.reels_per_day}
              target={`target ${target.reelsPerDay}`}
              met={pace.meets.reels}
            />
            <Metric
              name="Carousels a week"
              value={pace.carousels_per_week}
              target={`target ${target.carouselsPerWeek}`}
              met={pace.meets.carousels}
            />
            <Metric
              name="Days with a story"
              value={pace.story_days}
              target={
                pace.story_days_observed
                  ? `of ${pace.story_days_observed} looked at`
                  : 'not looked yet'
              }
              met={pace.meets.stories}
              whole
            />
          </div>

          <div className="chips">
            <span className="chip chip-static">reels <b>{pace.counts.reel}</b></span>
            <span className="chip chip-static">carousels <b>{pace.counts.carousel}</b></span>
            <span className="chip chip-static">photos <b>{pace.counts.photo}</b></span>
            {pace.longest_gap_days !== null && (
              <span className="chip chip-static">longest gap <b>{pace.longest_gap_days}d</b></span>
            )}
            {growth.followers_now !== null && (
              <span className="chip chip-static">
                followers <b>{compact(growth.followers_now)}</b>
                {growth.followers_gained !== null && growth.followers_gained !== 0 && (
                  <> ({growth.followers_gained > 0 ? '+' : ''}{compact(growth.followers_gained)})</>
                )}
              </span>
            )}
          </div>

          {pace.story_days_observed < 3 && (
            <span className="hint">
              Story habits need a few days of the daily pass before they mean anything —
              a day nobody looked is unknown, not a missed one.
            </span>
          )}
        </>
      )}
    </div>
  )
}

function Metric({
  name, value, target, met, whole = false,
}: {
  name: string
  value: number | null
  target: string
  met: boolean | null
  whole?: boolean
}) {
  const { label, state } = verdict(met)
  return (
    <div className="score" data-state={state}>
      <span className="score-name">{name}</span>
      <b className="score-value">{value === null ? '—' : whole ? value : value.toFixed(1)}</b>
      <span className="score-target">{target}</span>
      <span className="score-verdict">{label}</span>
    </div>
  )
}
