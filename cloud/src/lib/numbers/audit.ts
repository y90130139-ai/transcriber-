/**
 * The audit scorecard: where a creator stands, pillar by pillar, as a tier.
 *
 * Used twice — on a prospect before signing, from the screenshots she sends,
 * and on a signed model any time. Same card either way, so a prospect's
 * audit becomes her day-one baseline.
 *
 * Scoring is *relative to our roster*: a pillar's score is the share of our
 * models she beats on it. Until at least five models have numbers for a
 * metric, it falls back to the provisional ladder below and says so on the
 * card. Those ladders are house guesses to be retired, not benchmarks — the
 * published ones in this vertical do not survive a source check.
 *
 * Tiers use the letters creator standing already uses (S/A/B/C).
 *
 * Pure. Tested in test/numbers.test.ts.
 */
import { ratios, type Ratios, type Totals } from './metrics'
import type { PageType } from './diagnose'

export type Tier = 'S' | 'A' | 'B' | 'C'
export type Basis = 'roster' | 'provisional'

type MetricKey = keyof Ratios

/** Ladder rungs map to scores 25 / 50 / 75 / 100. PROVISIONAL — see header. */
export const PROVISIONAL: Partial<Record<MetricKey, [number, number, number, number]>> = {
  visits_per_day: [100, 300, 1000, 3000],
  visit_cvr: [0.005, 0.01, 0.02, 0.04],
  rev_per_visit: [0.05, 0.15, 0.4, 1],
  rev_per_new_sub: [2, 5, 12, 30],
  spender_share: [0.02, 0.05, 0.1, 0.2],
  renew_on_share: [0.1, 0.2, 0.35, 0.5],
}

/** Fewer roster values than this and a metric is scored on the provisional ladder. */
export const MIN_PEERS = 5

type PillarDef = { key: string; label: string; weight: number; metrics: MetricKey[]; lever: string; paidOnly?: boolean }

export const PILLARS: PillarDef[] = [
  { key: 'demand', label: 'Demand', weight: 20, metrics: ['visits_per_day'],
    lever: 'Traffic is the constraint: more reels on proven formats (the 70/20/10 split), and a tracking link on every placement so the next audit can say which source to scale.' },
  { key: 'conversion', label: 'Conversion', weight: 25, metrics: ['visit_cvr'],
    lever: 'Visits are not becoming subs: split guests from users first. Guest-heavy → fix the link path; user conversion low → fix the page or the offer.' },
  { key: 'money', label: 'Money', weight: 35, metrics: ['rev_per_visit', 'rev_per_new_sub'],
    lever: 'Subs are not paying: the first 48 hours (welcome, reply speed, first PPV) and the mass-message calendar.' },
  { key: 'depth', label: 'Buyer depth', weight: 10, metrics: ['spender_share'],
    lever: 'Too few fans buy at all: price ladder on PPV, and chatters working the non-spenders, not only the whales.' },
  { key: 'retention', label: 'Retention', weight: 10, metrics: ['renew_on_share'], paidOnly: true,
    lever: 'Fans leave at month end: expiry reminders, renew-on incentives, and a reason to stay in the last week of the month.' },
]

export type Pillar = {
  key: string
  label: string
  score: number | null
  basis: Basis | null
  values: Partial<Record<MetricKey, number | null>>
  lever: string
}

export type Scorecard = {
  tier: Tier | null
  score: number | null
  pillars: Pillar[]
  /** The weakest scored pillar — where the first month of work goes. */
  fixFirst: Pillar | null
  confidence: 'high' | 'low'
  notes: string[]
}

/** Score on a four-rung ladder, linear between rungs, 0 at zero, capped at 100. */
export function ladderScore(value: number, rungs: readonly [number, number, number, number]): number {
  if (value <= 0) return 0
  if (value < rungs[0]) return (value / rungs[0]) * 25
  for (let i = 1; i < rungs.length; i++) {
    if (value < rungs[i]) return 25 * i + ((value - rungs[i - 1]) / (rungs[i] - rungs[i - 1])) * 25
  }
  return 100
}

/** Share of peers this value beats (ties count half), 0–100. */
export function percentile(value: number, peers: readonly number[]): number {
  if (!peers.length) return 50
  const below = peers.filter((p) => p < value).length
  const tied = peers.filter((p) => p === value).length
  return ((below + tied / 2) / peers.length) * 100
}

export function tierOf(score: number): Tier {
  return score >= 80 ? 'S' : score >= 60 ? 'A' : score >= 40 ? 'B' : 'C'
}

/**
 * `peers` holds, per metric, the values of the other models on the roster for
 * the same window length — never including the one being scored.
 */
export function scorecard(t: Totals, page: PageType, peers: Partial<Record<MetricKey, number[]>> = {}): Scorecard {
  const r = ratios(t)
  const notes: string[] = []
  const pillars: Pillar[] = []
  for (const def of PILLARS) {
    if (def.paidOnly && page !== 'paid') continue
    const scores: number[] = []
    let basis: Basis | null = null
    const values: Pillar['values'] = {}
    for (const metric of def.metrics) {
      const value = r[metric]
      values[metric] = value
      if (value === null) continue
      const roster = (peers[metric] ?? []).filter((v) => Number.isFinite(v))
      if (roster.length >= MIN_PEERS) {
        scores.push(percentile(value, roster))
        basis = basis ?? 'roster'
      } else if (PROVISIONAL[metric]) {
        scores.push(ladderScore(value, PROVISIONAL[metric]!))
        basis = 'provisional'
      }
    }
    pillars.push({
      key: def.key, label: def.label, values, lever: def.lever, basis,
      score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    })
  }
  const scored = pillars.filter((p) => p.score !== null)
  const weightOf = (p: Pillar) => PILLARS.find((d) => d.key === p.key)!.weight
  const totalWeight = scored.reduce((s, p) => s + weightOf(p), 0)
  const score = totalWeight ? Math.round(scored.reduce((s, p) => s + p.score! * weightOf(p), 0) / totalWeight) : null
  const missing = pillars.filter((p) => p.score === null).map((p) => p.label)
  if (missing.length) notes.push(`Not scored — no numbers for: ${missing.join(', ')}.`)
  if (scored.some((p) => p.basis === 'provisional')) notes.push('Some pillars are scored on provisional house ladders, not the roster — fewer than five models have that number yet.')
  if (t.days_read < 14) notes.push(`Only ${t.days_read} days of numbers — too short to tell a trend from a good week.`)
  if (page === null) notes.push('Page type (free / paid) not set, so retention was not scored.')
  const confidence = t.days_read >= 14 && scored.length >= 3 ? 'high' : 'low'
  const fixFirst = scored.length ? [...scored].sort((a, b) => a.score! - b.score! || weightOf(b) - weightOf(a))[0] : null
  return { tier: score === null ? null : tierOf(score), score, pillars, fixFirst, confidence, notes }
}
