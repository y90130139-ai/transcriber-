// node --import ./test/ts-resolve.mjs --test test/reddit-requirements.test.ts
//
// The estimator's rules, tested without a database or a network:
//   - no data means null, never zero
//   - the minimum survivor reading is the bound; filtered authors are
//     counted but never invent a bound
//   - `verified` is earned by stability across passes, not by one sample
//   - eligibility verdicts carry their uncertainty
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIDENCE_LABEL,
  eligibility,
  estimateRequirements,
  HIGH_SURVIVORS,
  MIN_SURVIVORS,
  postsPerDay,
  type SamplePoint,
} from '../src/lib/reddit/requirements'
import type { RequirementProfileStats, RequirementRow } from '../src/lib/reddit/types'

const survivor = (link: number | null, comment: number | null, age: number | null): SamplePoint =>
  ({ outcome: 'survived', link_karma: link, comment_karma: comment, account_age_days: age })

function survivors(count: number, link = 50, comment = 20, age = 30): SamplePoint[] {
  return Array.from({ length: count }, (_, index) =>
    survivor(link + index, comment + index, age + index))
}

test('fewer survivors than the floor produces no estimate at all', () => {
  const estimate = estimateRequirements(survivors(MIN_SURVIVORS - 1))
  assert.equal(estimate.confidence, 'insufficient')
  assert.equal(estimate.min_post_karma, null)
  assert.equal(estimate.min_comment_karma, null)
  assert.equal(estimate.min_age_days, null)
  assert.equal(estimate.avg_total_karma, null)
})

test('the minimum survivor reading is the bound, and nothing else is', () => {
  const samples = [
    survivor(80, 40, 30),
    survivor(42, 15, 12),
    survivor(120, 60, 90),
    survivor(300, 500, 400),
    survivor(60, 25, 44),
    { outcome: 'pending', link_karma: null, comment_karma: null, account_age_days: null } as SamplePoint,
    { outcome: 'removed', link_karma: 1, comment_karma: 1, account_age_days: 1 } as SamplePoint,
  ]
  const estimate = estimateRequirements(samples)
  assert.equal(estimate.confidence, 'low')
  assert.equal(estimate.min_post_karma, 42)
  assert.equal(estimate.min_comment_karma, 15)
  assert.equal(estimate.min_age_days, 12)
  // (42+15 + 80+40 + 120+60 + 300+500 + 60+25) / 5 = 1242/5 = 248.4 → 248
  assert.equal(estimate.avg_total_karma, 248)
  assert.equal(estimate.filtered_count, 0)
})

test('filtered authors are counted as evidence but never lower a bound', () => {
  const samples = [
    ...survivors(MIN_SURVIVORS, 100, 50, 60),
    { outcome: 'filtered', link_karma: 3, comment_karma: 1, account_age_days: 0 } as SamplePoint,
    { outcome: 'filtered', link_karma: 9, comment_karma: 4, account_age_days: 1 } as SamplePoint,
  ]
  const estimate = estimateRequirements(samples)
  assert.equal(estimate.filtered_count, 2)
  assert.equal(estimate.min_post_karma, 100)
  assert.equal(estimate.min_age_days, 60)
})

test('survivors without a profile are not evidence', () => {
  const samples = [
    ...survivors(MIN_SURVIVORS - 1),
    { outcome: 'survived', link_karma: null, comment_karma: null, account_age_days: null } as SamplePoint,
  ]
  const estimate = estimateRequirements(samples)
  assert.equal(estimate.survivor_count, MIN_SURVIVORS)
  // The floor counts *profiled* survivors: four is below it, so no estimate.
  assert.equal(estimate.confidence, 'insufficient')
  assert.equal(estimate.profile_count, MIN_SURVIVORS - 1)
  assert.equal(estimate.min_post_karma, null)
})

test('verified is earned by stability: three passes within tolerance', () => {
  const samples = survivors(HIGH_SURVIVORS, 100, 50, 60)
  const first = estimateRequirements(samples)
  assert.equal(first.confidence, 'high')
  assert.equal(first.confirmations, 0)

  const second = estimateRequirements(samples, {
    min_post_karma: first.min_post_karma, min_comment_karma: first.min_comment_karma,
    min_age_days: first.min_age_days, confirmations: first.confirmations,
  })
  assert.equal(second.confirmations, 1)
  const third = estimateRequirements(samples, {
    min_post_karma: second.min_post_karma, min_comment_karma: second.min_comment_karma,
    min_age_days: second.min_age_days, confirmations: second.confirmations,
  })
  const fourth = estimateRequirements(samples, {
    min_post_karma: third.min_post_karma, min_comment_karma: third.min_comment_karma,
    min_age_days: third.min_age_days, confirmations: third.confirmations,
  })
  assert.equal(fourth.confirmations, 3)
  assert.equal(fourth.confidence, 'verified')
})

test('a wildly different bound resets the stability counter', () => {
  // A survivor with 2 karma appearing halves the minimum — the old bounds
  // no longer hold, so verification restarts.
  const samples = [...survivors(20, 100, 50, 60), survivor(2, 1, 3)]
  const estimate = estimateRequirements(samples, {
    min_post_karma: 100, min_comment_karma: 50, min_age_days: 60, confirmations: 2,
  })
  assert.equal(estimate.min_post_karma, 2)
  assert.equal(estimate.confirmations, 0)
})

test('posts per day refuses to extrapolate from thin or bursty windows', () => {
  assert.equal(postsPerDay([]), null)
  // Nine posts cannot carry a rate.
  assert.equal(postsPerDay(Array.from({ length: 9 }, (_, i) => 1_000_000 + i * 3600)), null)
  // Ten posts inside ten minutes is a burst, not a cadence.
  assert.equal(postsPerDay(Array.from({ length: 10 }, (_, i) => 1_000_000 + i * 60)), null)
  // 24 posts across the 11.5h between first and last → ~50.1/day.
  const day = Array.from({ length: 24 }, (_, i) => 1_000_000 + i * 1800)
  assert.equal(postsPerDay(day), 50.1)
})

const row = (patch: Partial<RequirementRow>): RequirementRow => ({
  id: 'x', display_name: 'x', url: null, category: 'c', over18: true, enabled: true,
  priority: 'medium', status: 'active', status_note: null, subscribers: null,
  posts_per_day: null, sample_count: 0, survivor_count: 0, filtered_count: 0,
  profile_count: 0, min_post_karma: null, min_comment_karma: null, min_age_days: null,
  avg_total_karma: null, confirmations: 0, confidence: 'insufficient',
  bot_bouncer: 'unknown', bot_bouncer_source: null, bot_bouncer_checked_at: null,
  first_collected_at: null, last_collected_at: null, about_at: null, next_due_at: null,
  last_error: null, consecutive_failures: 0, source: 'seed',
  ...patch,
})

const profile = (patch: Partial<RequirementProfileStats>): RequirementProfileStats => ({
  username: 'account', link_karma: null, comment_karma: null, total_karma: null,
  created_utc: null, over18: null, fetched_at: new Date().toISOString(), age_days: null,
  ...patch,
})

test('eligibility says under only when the account is below a measured bound', () => {
  const target = row({ min_post_karma: 50, min_comment_karma: 10, min_age_days: 30 })
  const fits = eligibility(profile({ link_karma: 60, comment_karma: 10, age_days: 30 }), target)
  assert.equal(fits.overall, 'fits')
  assert.equal(fits.post_karma, 'ok')

  const under = eligibility(profile({ link_karma: 49, comment_karma: 50, age_days: 300 }), target)
  assert.equal(under.overall, 'under')
  assert.equal(under.post_karma, 'under')

  const unknown = eligibility(profile({ link_karma: null, comment_karma: null, age_days: null }), target)
  assert.equal(unknown.overall, 'unknown')

  const noBounds = eligibility(profile({ link_karma: 1, comment_karma: 1, age_days: 1 }), row({}))
  assert.equal(noBounds.overall, 'unknown')
})

test('every confidence tier has a label the UI can show', () => {
  for (const tier of ['verified', 'high', 'medium', 'low', 'insufficient'] as const) {
    assert.ok(CONFIDENCE_LABEL[tier]?.length > 0)
  }
})
