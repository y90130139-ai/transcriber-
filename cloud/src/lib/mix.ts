/**
 * The 70/20/10 split — Reskins, Iterations, New Tests.
 *
 * Not the marketing-budget 70/20/10 and not the value/curated/promotional
 * content mix. This is an *output allocation* for one creator's own reels:
 *
 *   70%  Reskins      recreate her own proven winners  (>10x her median views)
 *   20%  Iterations   re-run the medium performers     (3-5x median)
 *   10%  New Tests    new verticals, trends, angles    (no history yet)
 *
 * At 21 reels a week that is 15 / 4 / 2.
 *
 * **A post's bucket comes from how it performed against her own rolling 30-day
 * median — never from its format.** The first version of this file classified
 * by `models.formats` and `models.hooks` and was wrong on exactly that axis: it
 * asked "is this the kind of thing she makes" when the rule asks "did this, or
 * something like it, already win for her". Format is a property of an idea;
 * the split is a property of evidence. Rebuilt 2026-09-20 against Geno's own
 * breakdown.
 *
 * Median, not average, and her own median rather than an absolute number:
 * reels are power-law, so one outlier drags a mean and a 5k account and an 80k
 * account cannot share a threshold.
 *
 * What is deliberately missing: **watch-through rate**. The full grading matrix
 * routes on views × watch-through, which is what separates "the hook worked and
 * the body failed" from a real winner. Watch time lives in her own Instagram
 * Insights and cannot be read from outside the account, so only the views half
 * of the matrix is computable here. Anything claiming otherwise would be
 * inventing the number.
 *
 * The 5x-10x band is unresolved in the source docs. Treated as Iteration here,
 * which is the more conservative of the two readings.
 */
import { sql } from './db'

/** Shares of a week. */
export const TARGET_MIX = { reskin: 0.7, iteration: 0.2, test: 0.1 } as const

/** Multiples of her own rolling median views. */
export const THRESHOLD = { reskin: 10, iteration: 3 } as const

/** The window her median is taken over. */
export const MEDIAN_DAYS = 30

/** Posts needed before a median means anything. */
const MIN_HISTORY = 5

export type Band = 'reskin' | 'iteration' | 'test'

export type Graded = {
  post_id: string
  posted_at: string | null
  plays: number | null
  multiple: number | null
  band: Band
}

export type Mix = {
  handle: string
  median_plays: number | null
  history: number
  counts: Record<Band, number>
  shares: Record<Band, number>
  target: typeof TARGET_MIX
  /** Signed distance from target. Positive is over-weighted. */
  drift: Record<Band, number>
  /** Which bucket the next reel should come from. */
  wants: Band | null
  basis: 'own-median' | 'none'
  unreadable?: string
}

const BANDS: Band[] = ['reskin', 'iteration', 'test']

/** One post's bucket, from its multiple of her median. */
export function band(multiple: number | null): Band {
  if (multiple === null) return 'test'
  if (multiple >= THRESHOLD.reskin) return 'reskin'
  if (multiple >= THRESHOLD.iteration) return 'iteration'
  return 'test'
}

/**
 * How one creator's recent reels grade out, and how far that sits from the
 * rule. Handle-agnostic like everything else here, though it only means
 * something for an account we are trying to steer.
 */
export async function mixFor(handle: string, windowDays = MEDIAN_DAYS): Promise<Mix> {
  const rows = await sql.query(
    `select post_id, posted_at, plays
       from transcriber.creator_posts
      where handle = $1
        and kind = 'reel'
        and plays is not null
        and posted_at >= now() - ($2 || ' days')::interval
      order by posted_at desc`,
    [handle, String(windowDays)],
  )

  const zero: Record<Band, number> = { reskin: 0, iteration: 0, test: 0 }

  // A median off two posts is not a baseline, it is a coin toss. Say so rather
  // than grading a week against noise.
  if (rows.length < MIN_HISTORY) {
    return {
      handle,
      median_plays: null,
      history: rows.length,
      counts: zero,
      shares: zero,
      target: TARGET_MIX,
      drift: zero,
      wants: null,
      basis: 'none',
      unreadable:
        `Only ${rows.length} reel${rows.length === 1 ? '' : 's'} with plays in the last ` +
        `${windowDays} days. A median needs at least ${MIN_HISTORY} before it means anything.`,
    }
  }

  const plays = rows.map((r) => Number(r.plays)).sort((a, b) => a - b)
  const mid = Math.floor(plays.length / 2)
  const median = plays.length % 2 ? plays[mid] : (plays[mid - 1] + plays[mid]) / 2

  const counts = { ...zero }
  for (const row of rows) {
    const multiple = median > 0 ? Number(row.plays) / median : null
    counts[band(multiple)] += 1
  }

  const items = rows.length
  const shares = {} as Record<Band, number>
  const drift = {} as Record<Band, number>
  for (const b of BANDS) {
    shares[b] = round(counts[b] / items, 3)
    drift[b] = round(shares[b] - TARGET_MIX[b], 3)
  }

  return {
    handle,
    median_plays: median,
    history: items,
    counts,
    shares,
    target: TARGET_MIX,
    drift,
    wants: BANDS.reduce((low, b) => (drift[b] < drift[low] ? b : low), BANDS[0]),
    basis: 'own-median',
  }
}

/** Her winners, highest multiple first — the pool the 70% is drawn from. */
export async function winners(handle: string, windowDays = MEDIAN_DAYS): Promise<Graded[]> {
  const mix = await mixFor(handle, windowDays)
  if (mix.basis === 'none' || !mix.median_plays) return []

  const rows = await sql.query(
    `select post_id, posted_at, plays
       from transcriber.creator_posts
      where handle = $1
        and kind = 'reel'
        and plays is not null
        and posted_at >= now() - ($2 || ' days')::interval
      order by plays desc`,
    [handle, String(windowDays)],
  )

  return rows.map((row) => {
    const multiple = round(Number(row.plays) / (mix.median_plays as number), 2)
    return {
      post_id: String(row.post_id),
      posted_at: row.posted_at ? String(row.posted_at) : null,
      plays: Number(row.plays),
      multiple,
      band: band(multiple),
    }
  })
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
