/**
 * The requirements estimator.
 *
 * Everything here is pure — no database, no network — so the same math runs
 * in the collector (writing the board) and in the browser (deciding what a
 * typed username would score against each row). The rules it encodes:
 *
 *   - The lowest karma / shortest account age seen among *surviving* posts
 *     bounds a gate from above: somebody posted with this, so the gate must
 *     be at most this. Many samples converge on it.
 *   - Authors whose post AutoMod filtered bound it from below. With evidence
 *     on both sides, the gate lives in the gap.
 *   - No data means null — never zero, never a guess. A gate of "0" and an
 *     unmeasured gate are different facts and the board must not conflate
 *     them.
 *   - `verified` is earned by stability: the same bounds holding across
 *     several collection passes, not by a single lucky sample.
 */

import type { RequirementConfidence, RequirementProfileStats, RequirementRow } from './types'

export type SampleOutcome = 'pending' | 'survived' | 'filtered' | 'removed' | 'unavailable'

export type SamplePoint = {
  outcome: SampleOutcome
  link_karma: number | null
  comment_karma: number | null
  account_age_days: number | null
}

export type PreviousEstimate = {
  min_post_karma: number | null
  min_comment_karma: number | null
  min_age_days: number | null
  confirmations: number
}

export type Estimate = {
  sample_count: number
  survivor_count: number
  filtered_count: number
  profile_count: number
  min_post_karma: number | null
  min_comment_karma: number | null
  min_age_days: number | null
  avg_total_karma: number | null
  confirmations: number
  confidence: RequirementConfidence
}

/** Below this many profiled survivors nothing is estimated at all. */
export const MIN_SURVIVORS = 5
export const MEDIUM_SURVIVORS = 15
export const HIGH_SURVIVORS = 30
/** Passes the bounds must hold, within tolerance, to count as verified. */
export const VERIFY_CONFIRMATIONS = 3

const has = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** A bound "holds" when the new reading is within 25% (min 5 units) of the
 *  old one — karma drifts and a gate does not, so a stable *minimum* is the
 *  signal, not an identical one. */
function holds(next: number | null, previous: number | null): boolean {
  if (next === null || previous === null) return false
  const tolerance = Math.max(5, previous * 0.25)
  return Math.abs(next - previous) <= tolerance
}

export function estimateRequirements(samples: SamplePoint[], previous?: PreviousEstimate | null): Estimate {
  const survivors = samples.filter((sample) => sample.outcome === 'survived')
  const profiledSurvivors = survivors.filter((sample) => has(sample.link_karma) || has(sample.comment_karma) || has(sample.account_age_days))
  const filtered = samples.filter((sample) => sample.outcome === 'filtered')
  const profiled = samples.filter((sample) => has(sample.link_karma) || has(sample.comment_karma) || has(sample.account_age_days))

  const minOf = (values: (number | null)[]): number | null => {
    const clean = values.filter(has)
    return clean.length ? Math.min(...clean) : null
  }

  const minPost = minOf(profiledSurvivors.map((sample) => sample.link_karma))
  const minComment = minOf(profiledSurvivors.map((sample) => sample.comment_karma))
  const minAge = minOf(profiledSurvivors.map((sample) => sample.account_age_days))

  const totals = profiledSurvivors
    .filter((sample) => has(sample.link_karma) && has(sample.comment_karma))
    .map((sample) => (sample.link_karma as number) + (sample.comment_karma as number))
  const avgTotal = totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : null

  const enough = profiledSurvivors.length >= MIN_SURVIVORS
  const survivorCount = profiledSurvivors.length

  let confirmations = 0
  if (enough && previous) {
    const stablePost = minPost === null || previous.min_post_karma === null || holds(minPost, previous.min_post_karma)
    const stableComment = minComment === null || previous.min_comment_karma === null || holds(minComment, previous.min_comment_karma)
    const stableAge = minAge === null || previous.min_age_days === null || holds(minAge, previous.min_age_days)
    if ((stablePost && stableComment && stableAge) && (minPost !== null || minComment !== null || minAge !== null)) {
      confirmations = previous.confirmations + 1
    }
  }

  let confidence: RequirementConfidence
  if (!enough) confidence = 'insufficient'
  else if (survivorCount >= HIGH_SURVIVORS && confirmations >= VERIFY_CONFIRMATIONS) confidence = 'verified'
  else if (survivorCount >= HIGH_SURVIVORS) confidence = 'high'
  else if (survivorCount >= MEDIUM_SURVIVORS) confidence = 'medium'
  else confidence = 'low'

  return {
    sample_count: samples.length,
    survivor_count: survivors.length,
    filtered_count: filtered.length,
    profile_count: profiled.length,
    min_post_karma: enough ? minPost : null,
    min_comment_karma: enough ? minComment : null,
    min_age_days: enough ? minAge : null,
    avg_total_karma: enough ? avgTotal : null,
    confirmations,
    confidence,
  }
}

/** New posts per day, extrapolated from a listing's own timestamps. The
 *  window is the span the sample actually covers; a page of 100 posts on a
 *  quiet community covers days, on a busy one an hour. */
export function postsPerDay(createdUtc: (string | number)[], pageSize = 100): number | null {
  const times = createdUtc
    .map((value) => (typeof value === 'number' ? value * 1000 : Date.parse(String(value))))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (times.length < 10) return null
  const spanMs = times[times.length - 1] - times[0]
  // A same-minute page is a burst, not a rate; refuse to extrapolate from it.
  if (spanMs < 30 * 60 * 1000) return null
  const perDay = (times.length / spanMs) * 86_400_000
  return Math.round(perDay * 10) / 10
}

/** The account a person typed, measured against one row's estimates. Every
 *  verdict carries its uncertainty: estimates are upper bounds, so "ok"
 *  means "at or above everything we have ever seen survive" — the honest
 *  meaning of "would likely pass". */
export type CriterionVerdict = 'ok' | 'under' | 'unknown'
export type UserVerdict = {
  post_karma: CriterionVerdict
  comment_karma: CriterionVerdict
  age: CriterionVerdict
  overall: 'fits' | 'under' | 'unknown'
}

export function eligibility(profile: RequirementProfileStats | null, row: RequirementRow): UserVerdict {
  const judge = (value: number | null | undefined, required: number | null | undefined): CriterionVerdict => {
    if (!has(required as number) || !has(value as number)) return 'unknown'
    return (value as number) >= (required as number) ? 'ok' : 'under'
  }
  const post = judge(profile?.link_karma ?? null, row.min_post_karma)
  const comment = judge(profile?.comment_karma ?? null, row.min_comment_karma)
  const age = judge(profile?.age_days ?? null, row.min_age_days)
  const verdicts = [post, comment, age]
  const overall = verdicts.includes('under') ? 'under'
    : verdicts.every((verdict) => verdict === 'unknown') ? 'unknown'
    : 'fits'
  return { post_karma: post, comment_karma: comment, age, overall }
}

/** The word the Verification column shows, kept next to the math so the two
 *  cannot drift apart. */
export const CONFIDENCE_LABEL: Record<RequirementConfidence, string> = {
  verified: 'Verified',
  high: 'Likely',
  medium: 'Estimated',
  low: 'Rough',
  insufficient: 'No data',
}

export const CONFIDENCE_NOTE: Record<RequirementConfidence, string> = {
  verified: 'The same bounds held across three or more collection passes',
  high: 'Thirty or more surviving posters sampled',
  medium: 'Fifteen or more surviving posters sampled',
  low: 'A few surviving posters — a hint, not a gate',
  insufficient: 'Fewer than five profiled survivors; nothing estimated yet',
}

/** Days the estimator wants between a post being sampled and its survival
 *  being judged — AutoMod acts fast, but not instantly for every queue. */
export const JUDGE_AFTER_HOURS = 6
