'use client'

import { formatDate } from '@/lib/dates'
import type { Trend } from '@/lib/engagement'

const WIDTH = 280
const HEIGHT = 96
const PAD = 10
/** The scale never shrinks below this many points, so a wobble of 3 is not
 *  drawn as a cliff. */
const MIN_SPAN = 30

/** Her score at each of her recent sent weeks. The scale fits her own range
 *  (never tighter than MIN_SPAN) so a real move reads as one; the first and
 *  last scores are printed, so the shape is never the only evidence. */
export default function TrendLine({ trend }: { trend: Trend }) {
  const points = trend.series
  const x = (index: number) =>
    points.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - PAD * 2)) / (points.length - 1)
  const scores = points.map((point) => point.score)
  const mid = (Math.max(...scores) + Math.min(...scores)) / 2
  const span = Math.max(MIN_SPAN, Math.max(...scores) - Math.min(...scores))
  const low = Math.max(0, Math.min(100 - span, mid - span / 2))
  const y = (score: number) => PAD + ((low + span - score) * (HEIGHT - PAD * 2)) / span
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.score)}`).join(' ')
  const last = points[points.length - 1]

  return (
    <figure className="trendline" data-direction={trend.direction}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
        aria-label={`Score by sent week: ${points.map((p) => `${formatDate(p.week_of)} ${p.score}`).join(', ')}`}>
        <path className="trendline-path" d={path} />
        {points.map((point, index) => (
          <circle key={point.week_of} className="trendline-dot" cx={x(index)} cy={y(point.score)}
            r={point === last ? 4 : 2.5} data-last={point === last || undefined} />
        ))}
      </svg>
      <figcaption>
        <span>{formatDate(points[0].week_of)} · <b>{points[0].score}</b></span>
        <span>{formatDate(last.week_of)} · <b>{last.score}</b></span>
      </figcaption>
    </figure>
  )
}
