/**
 * The trend arithmetic, as pure functions so it can be tested without a
 * database and reasoned about without a running system.
 *
 * Ground rules from the brief, restated here because every function below
 * depends on them:
 *
 *   - A tiny community with ten posts is never compared as an equal of a
 *     huge one. Every rate is per hour against the entity's *own* trailing
 *     baseline, so size cancels out.
 *   - A score is only as loud as the evidence behind it. Confidence starts
 *     at zero, thresholds gate the loud statuses, and a reading without a
 *     baseline is labelled `building` rather than dressed up as a change.
 *   - Reddit's score is upvotes-minus-downvotes, never impressions. Nothing
 *     here multiplies it into a "reach" number; engagement is the sum of
 *     observed score and comment count and is labelled as such everywhere.
 *   - Nothing is ever fabricated. A null input produces a null output and
 *     the UI says "building baseline" instead of showing a made-up number.
 */

import type { TrendStatus } from './types'

/** Laplace smoothing, in mentions *per day*. Without it a topic going from
 *  0 to 1 mention reads as infinite growth instead of the small event it is. */
export const SMOOTHING = 1

/** Days of trailing history a topic needs before a growth figure is real. */
export const BASELINE_DAYS = 3

/** Below this many observed mentions in the window, no loud status. */
export const MIN_MENTIONS = 3

/**
 * How much of a reading is trustworthy, 0–1. Three independent caps —
 * mentions, distinct authors, baseline days — multiplied, because a hundred
 * mentions from one author across one day of history is still one voice.
 */
export function confidenceOf(input: {
  mentions: number
  authors: number
  baselineDays: number
}): number {
  const mentioned = clamp01(input.mentions / 8)      // ~8 mentions → full
  const voices = clamp01(input.authors / 4)          // ~4 authors → full
  const history = clamp01(input.baselineDays / BASELINE_DAYS)
  return round3(mentioned * voices * history)
}

/**
 * The Reddit Interest Index, 0–100.
 *
 * `ratio = (current + s) / (baseline + s)` where both rates are mentions
 * per day. 50 is "at its own normal", and the log curve is symmetric, so
 * falling and rising are measured by the same ruler. The additive smoothing
 * (`s = 1 mention/day`) is deliberate and slightly conservative at small
 * numbers: a topic going 2 → 4 mentions/day reads ~68, not 75, because one
 * extra mention is not yet evidence of doubling. The whole reading is then
 * shrunk toward 50 by confidence, so a thin sample cannot post an extreme
 * score.
 */
export function interestIndex(input: {
  currentRate: number
  baselineRate: number
  confidence: number
}): number {
  const ratio = (Math.max(0, input.currentRate) + SMOOTHING) / (Math.max(0, input.baselineRate) + SMOOTHING)
  const raw = 50 + 25 * Math.log2(ratio)
  const shrunk = 50 + (raw - 50) * clamp01(input.confidence)
  return round1(clamp(shrunk, 0, 100))
}

/**
 * Growth as a fraction: `(current - baseline) / baseline`, with the same
 * smoothing in the denominator. Null when there is no baseline at all —
 * "new" is a different statement from "+300%", and the caller says which.
 */
export function growthOf(currentRate: number, baselineRate: number | null): number | null {
  if (baselineRate === null || baselineRate <= 0) return currentRate > 0 ? null : 0
  return round3((currentRate - baselineRate) / (baselineRate + SMOOTHING))
}

/** Engagement units (score + comments, summed) per hour of exposure. */
export function velocityOf(engagement: number, hours: number): number | null {
  if (!Number.isFinite(engagement) || !Number.isFinite(hours) || hours <= 0) return null
  return round2(engagement / hours)
}

/**
 * Breakout, 0–1. A blend, not a product, because a topic can break out on
 * spread alone: 60% sustained growth (1.0 growth → full marks at +100%),
 * 25% velocity relative to what the window has seen (velocity share against
 * the batch maximum), 15% independent-community spread (4+ communities →
 * full). Multiplied by confidence so an unproven spike cannot scream.
 */
export function breakoutOf(input: {
  growth: number | null
  velocityShare: number
  subreddits: number
  confidence: number
}): number | null {
  if (input.growth === null) return null
  const growthPart = clamp01(Math.max(0, input.growth))
  const velocityPart = clamp01(input.velocityShare)
  const spreadPart = clamp01(input.subreddits / 4)
  const blended = 0.6 * growthPart + 0.25 * velocityPart + 0.15 * spreadPart
  return round3(clamp01(blended * input.confidence))
}

/**
 * The status the table shows. Order matters: breakout beats rising, and
 * `building` beats everything when the evidence cannot support any of them.
 */
export function statusOf(input: {
  growth: number | null
  interest: number
  confidence: number
  mentions: number
  thresholds?: { breakoutInterest: number; breakoutGrowth: number; minMentions: number }
}): TrendStatus {
  const t = input.thresholds ?? { breakoutInterest: 76, breakoutGrowth: 1, minMentions: MIN_MENTIONS }
  if (input.confidence < 0.45 || input.mentions < t.minMentions) {
    return input.mentions > 0 ? 'building' : 'cooling'
  }
  if (input.interest >= t.breakoutInterest && (input.growth ?? 0) >= t.breakoutGrowth) return 'breakout'
  if ((input.growth ?? 0) >= 0.3) return 'rising'
  if ((input.growth ?? 0) <= -0.3) return 'cooling'
  return 'stable'
}

/**
 * The one number the Trending Now table sorts by when no column is chosen:
 * interest carried by growth, with a small nudge for spread, all shrunk by
 * confidence. Deliberately not exposed as a displayed metric — it exists so
 * a hot-but-quiet topic outranks a big-and-plateaued one.
 */
export function trendingScore(input: {
  interest: number
  growth: number | null
  subreddits: number
  confidence: number
}): number {
  const growthBoost = 1 + clamp(input.growth ?? 0, -0.8, 2)
  const spreadBoost = 1 + clamp01(input.subreddits / 8) * 0.2
  return round2(input.interest * growthBoost * spreadBoost * (0.5 + 0.5 * input.confidence))
}

/**
 * Community Activity Score, 0–100 — the subreddit page's one number.
 * Posting frequency against the community's own trailing baseline (the
 * same log curve as interest), blended with engagement per post relative to
 * its own recent average. Confidence again caps the extremes.
 */
export function communityActivityScore(input: {
  currentPostsPerDay: number
  baselinePostsPerDay: number | null
  engagementPerPost: number | null
  baselineEngagementPerPost: number | null
  confidence: number
}): number | null {
  if (input.baselinePostsPerDay === null && input.baselineEngagementPerPost === null) return null
  const frequency = interestIndex({
    currentRate: input.currentPostsPerDay,
    baselineRate: input.baselinePostsPerDay ?? input.currentPostsPerDay,
    confidence: 1,
  })
  const engagementRatio =
    input.engagementPerPost !== null && input.baselineEngagementPerPost
      ? clamp((input.engagementPerPost + 1) / (input.baselineEngagementPerPost + 1), 0.25, 4)
      : 1
  const engagementScore = 50 + 25 * Math.log2(engagementRatio)
  const blended = 0.6 * frequency + 0.4 * engagementScore
  return round1(clamp(50 + (blended - 50) * clamp01(input.confidence), 0, 100))
}

/**
 * Post velocity — observed score growth per hour from two snapshots. Falls
 * back to score ÷ age (labelled `observed: false` by the caller) when only
 * one reading exists, because that fallback is an estimate and must never
 * be presented as measured. Returns null when neither is possible.
 */
export function postVelocity(input: {
  score: number | null
  comments: number | null
  createdUtc: string
  now?: Date
  previous?: { score: number | null; comments: number | null; capturedAt: string } | null
}): number | null {
  const now = input.now ?? new Date()
  const score = input.score ?? 0
  const comments = input.comments ?? 0
  if (input.previous) {
    const hours = (now.getTime() - Date.parse(input.previous.capturedAt)) / 3_600_000
    if (hours > 0.05) {
      const delta = score + comments - ((input.previous.score ?? 0) + (input.previous.comments ?? 0))
      return round2(Math.max(0, delta) / hours)
    }
  }
  const ageHours = (now.getTime() - Date.parse(input.createdUtc)) / 3_600_000
  if (ageHours <= 0) return null
  return round2((score + comments) / ageHours)
}

/** Mean of a numeric series, null for an empty one. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return round2(values.reduce((total, value) => total + value, 0) / values.length)
}

/** Trailing daily sums → a rate per day. */
export function dailyRate(total: number, days: number): number {
  if (days <= 0) return 0
  return total / days
}

/** Evenly split a window into `buckets` spans, for chart series. */
export function bucketEdges(fromMs: number, toMs: number, buckets: number): number[] {
  const span = (toMs - fromMs) / buckets
  return Array.from({ length: buckets + 1 }, (_, i) => fromMs + span * i)
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))
const clamp01 = (value: number) => clamp(Number.isFinite(value) ? value : 0, 0, 1)
const round1 = (value: number) => Math.round(value * 10) / 10
const round2 = (value: number) => Math.round(value * 100) / 100
const round3 = (value: number) => Math.round(value * 1000) / 1000
