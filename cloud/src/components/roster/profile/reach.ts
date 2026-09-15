/** Turning a list of follower readings into the two things worth showing:
 *  where she is now, and which way she is going. */
import type { Platform } from '@/lib/socials'

export type Reading = {
  id: string
  platform: Platform
  followers: number
  source: 'manual' | 'insights'
  taken_at: string
}

export type Reach = {
  platform: Platform
  now: number
  /** The reading before the latest, or null when there is only one. A single
   *  reading has no direction, and inventing one from zero would draw every new
   *  account as an infinite rise. */
  was: number | null
  /** Days between the two, so "up 3.1k" can say over what. */
  days: number | null
  /** Oldest to newest, at most `SPARK`. Drawn as bars, not a line. */
  series: number[]
}

/** Six is enough to see a shape and few enough that each bar is wide enough to
 *  mean something at 390px. */
const SPARK = 6

const DAY_MS = 86_400_000

/**
 * One entry per account, newest first by recency of its latest reading.
 *
 * Grouped here rather than in SQL because the route returns every reading in
 * one pass — the whole set for one model is a few dozen rows at most, and one
 * query beats one per platform for a panel that opens on a tap.
 */
export function reachByPlatform(readings: Reading[]): Reach[] {
  const byPlatform = new Map<Platform, Reading[]>()
  for (const reading of readings) {
    const held = byPlatform.get(reading.platform)
    if (held) held.push(reading)
    else byPlatform.set(reading.platform, [reading])
  }

  const out: Reach[] = []
  for (const [platform, rows] of byPlatform) {
    // The route orders newest first; everything below reads oldest-to-newest.
    const ordered = [...rows].sort(
      (a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at),
    )
    const latest = ordered[ordered.length - 1]
    const prior = ordered.length > 1 ? ordered[ordered.length - 2] : null
    out.push({
      platform,
      now: latest.followers,
      was: prior ? prior.followers : null,
      days: prior
        ? Math.max(1, Math.round((Date.parse(latest.taken_at) - Date.parse(prior.taken_at)) / DAY_MS))
        : null,
      series: ordered.slice(-SPARK).map((row) => row.followers),
    })
  }

  return out.sort((a, b) => b.now - a.now)
}

/** Bar heights as percentages, scaled to the range rather than to zero.
 *
 *  Zero-based bars on a series like 128.0k → 128.4k are six identical bars,
 *  which says "nothing is happening" about a week that added four hundred
 *  people. The floor is the smallest reading, so the shape is the change. */
export function sparkHeights(series: number[]): number[] {
  if (series.length === 0) return []
  const low = Math.min(...series)
  const high = Math.max(...series)
  const span = high - low
  // Every reading identical is a real answer — flat, not empty.
  if (span === 0) return series.map(() => 50)
  return series.map((value) => 12 + ((value - low) / span) * 88)
}

/** `+3.1k in 7 days`, or null when there is nothing to compare against. */
export function deltaOf(reach: Reach): { text: string; way: 'up' | 'down' | 'flat' } | null {
  if (reach.was === null) return null
  const change = reach.now - reach.was
  const way = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const size = Math.abs(change)
  const shown = size >= 1000 ? `${(Math.round(size / 100) / 10).toString()}k` : size.toLocaleString('en-US')
  const sign = way === 'up' ? '+' : way === 'down' ? '−' : '±'
  const over = reach.days === 1 ? 'a day' : `${reach.days} days`
  return { text: `${sign}${shown} in ${over}`, way }
}
