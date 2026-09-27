/**
 * Which days moved, and what happened just before.
 *
 * A day is a spike when it clears 1.8× the median of the 14 days before it
 * *and* sits more than three robust deviations out — the second test stops a
 * quiet page's 3 → 6 subscribers from lighting up. The baseline trails the
 * day, never includes it, so a spike cannot hide itself by raising its own bar.
 *
 * Causes are candidates, not verdicts: a reel that beat her usual views the
 * day before a visitor spike, a mass message on an earnings spike. The page
 * shows them ranked and a person decides.
 *
 * Pure. Tested in test/numbers.test.ts.
 */
import { median, type Day, type DayMetric } from './metrics'

export type EventKind = 'reel' | 'mass_message' | 'promo' | 'price' | 'shoutout' | 'note'

export type NumbersEvent = {
  day: string
  kind: EventKind
  label: string
  /** How big it was, in the event's own terms: a reel's multiple of her median views, a mass message's revenue. */
  strength?: number | null
  url?: string | null
}

export type Cause = NumbersEvent & { lag: number; score: number }

export type Move = {
  day: string
  metric: DayMetric
  kind: 'spike' | 'dip'
  value: number
  baseline: number
  /** value ÷ baseline. */
  x: number
  causes: Cause[]
}

export const SPIKE = { window: 14, minPoints: 5, up: 1.8, down: 0.5, deviations: 3, minDelta: 5 } as const

/** Which events can plausibly move which number, and how many days they take to land. */
const RELEVANT: Partial<Record<DayMetric, { kinds: EventKind[]; lags: number[] }>> = {
  visitors: { kinds: ['reel', 'shoutout', 'promo', 'note'], lags: [0, 1, 2] },
  guests: { kinds: ['reel', 'shoutout', 'note'], lags: [0, 1, 2] },
  new_subs: { kinds: ['reel', 'shoutout', 'promo', 'price', 'note'], lags: [0, 1, 2] },
  earn_total: { kinds: ['mass_message', 'promo', 'price', 'note'], lags: [0, 1] },
  earn_messages: { kinds: ['mass_message', 'note'], lags: [0, 1] },
  earn_subs: { kinds: ['promo', 'price', 'shoutout', 'reel', 'note'], lags: [0, 1, 2] },
  earn_tips: { kinds: ['note', 'mass_message'], lags: [0, 1] },
}

const LAG_WEIGHT = [1, 0.8, 0.5]

export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
function mad(values: number[], mid: number): number {
  return (median(values.map((v) => Math.abs(v - mid))) ?? 0) * 1.4826
}

export function causesFor(day: string, metric: DayMetric, events: readonly NumbersEvent[]): Cause[] {
  const rule = RELEVANT[metric]
  if (!rule) return []
  const out: Cause[] = []
  for (const event of events) {
    if (!rule.kinds.includes(event.kind)) continue
    for (const lag of rule.lags) {
      if (shiftDay(day, -lag) !== event.day) continue
      const size = typeof event.strength === 'number' && event.strength > 0 ? Math.log2(1 + event.strength) : 1
      out.push({ ...event, lag, score: LAG_WEIGHT[lag] * size })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Every spike and dip in one metric's daily series. */
export function findMoves(days: readonly Day[], metric: DayMetric, events: readonly NumbersEvent[] = []): Move[] {
  const series = days
    .filter((d) => typeof d[metric] === 'number')
    .map((d) => ({ day: d.day, value: d[metric] as number }))
    .sort((a, b) => a.day.localeCompare(b.day))
  const moves: Move[] = []
  for (let i = 0; i < series.length; i++) {
    const { day, value } = series[i]
    const from = shiftDay(day, -SPIKE.window)
    const prior = series.slice(0, i).filter((p) => p.day >= from).map((p) => p.value)
    if (prior.length < SPIKE.minPoints) continue
    const base = median(prior)
    if (base === null) continue
    const spread = mad(prior, base)
    const far = spread > 0 ? Math.abs(value - base) > SPIKE.deviations * spread : true
    if (Math.abs(value - base) < SPIKE.minDelta || !far) continue
    const kind = base > 0 && value >= base * SPIKE.up ? 'spike' : value <= base * SPIKE.down ? 'dip' : null
    if (!kind) continue
    moves.push({ day, metric, kind, value, baseline: base, x: base > 0 ? value / base : Infinity, causes: causesFor(day, metric, events) })
  }
  return moves
}

/** Moves across the metrics that matter for the story, newest first. */
export function allMoves(days: readonly Day[], events: readonly NumbersEvent[] = [],
  metrics: readonly DayMetric[] = ['visitors', 'new_subs', 'earn_total', 'earn_messages']): Move[] {
  return metrics.flatMap((m) => findMoves(days, m, events)).sort((a, b) => b.day.localeCompare(a.day) || a.metric.localeCompare(b.metric))
}
