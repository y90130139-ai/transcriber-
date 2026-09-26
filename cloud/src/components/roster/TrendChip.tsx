'use client'

import type { Trend } from '@/lib/engagement'

/**
 * Which way she is heading, as an arrow and the size of the move.
 *
 * On a photo it only appears for a real move — a flat arrow on every picture is
 * decoration, and the point of the corner is that it is empty unless something
 * changed. Inline, flat is said out loud, because there the absence would read
 * as "unknown".
 */
export default function TrendChip({
  trend,
  variant = 'photo',
}: {
  trend: Trend | null | undefined
  variant?: 'photo' | 'inline'
}) {
  if (!trend) return null
  if (variant === 'photo' && trend.direction === 'flat') return null

  const arrow = trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '▬'
  const signed = trend.delta > 0 ? `+${trend.delta}` : `${trend.delta}`
  const words = trend.direction === 'up' ? 'Trending up' : trend.direction === 'down' ? 'Trending down' : 'Holding steady'

  return (
    <span
      className="trendchip"
      data-variant={variant}
      data-direction={trend.direction}
      title={`${words}: ${trend.previous} → ${trend.previous + trend.delta} since their previous sent week`}
      aria-label={`${words}, ${signed} points`}
    >
      <span aria-hidden="true">{arrow}</span> {signed}
    </span>
  )
}
