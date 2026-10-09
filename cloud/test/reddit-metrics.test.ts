// node --import ./test/ts-resolve.mjs --test test/reddit-metrics.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  breakoutOf,
  bucketEdges,
  communityActivityScore,
  confidenceOf,
  dailyRate,
  growthOf,
  interestIndex,
  mean,
  postVelocity,
  statusOf,
  trendingScore,
  velocityOf,
} from '../src/lib/reddit/metrics'

test('confidence needs mentions, voices and history together', () => {
  assert.equal(confidenceOf({ mentions: 0, authors: 0, baselineDays: 0 }), 0)
  assert.equal(confidenceOf({ mentions: 8, authors: 4, baselineDays: 3 }), 1)
  // One voice with many mentions is still one voice.
  assert.ok(confidenceOf({ mentions: 40, authors: 1, baselineDays: 7 }) <= 0.25)
  // Full history cannot rescue a thin sample.
  assert.ok(confidenceOf({ mentions: 1, authors: 1, baselineDays: 7 }) <= 0.13)
})

test('interest sits at 50 at baseline and moves logarithmically', () => {
  const options = { currentRate: 2, baselineRate: 2, confidence: 1 }
  assert.equal(interestIndex(options), 50)
  // Doubling reads high-60s: smoothing keeps one extra mention from
  // claiming a doubling.
  const doubled = interestIndex({ currentRate: 4, baselineRate: 2, confidence: 1 })
  assert.ok(doubled > 60 && doubled < 80, `doubled=${doubled}`)
  // A much bigger multiple approaches the cap.
  assert.equal(interestIndex({ currentRate: 100, baselineRate: 1, confidence: 1 }), 100)
  // Falling is symmetric on the other side of 50.
  assert.ok(interestIndex({ currentRate: 1, baselineRate: 4, confidence: 1 }) < 50)
  // Confidence shrinks the reading toward the middle.
  const thin = interestIndex({ currentRate: 100, baselineRate: 1, confidence: 0.25 })
  assert.ok(thin > 50 && thin < 100, `expected shrink, got ${thin}`)
})

test('interest handles a brand-new topic without dividing by zero', () => {
  const score = interestIndex({ currentRate: 3, baselineRate: 0, confidence: 0.4 })
  assert.ok(Number.isFinite(score) && score >= 0 && score <= 100)
})

test('growth is null without a baseline, a fraction with one', () => {
  assert.equal(growthOf(3, null), null)
  assert.equal(growthOf(0, 0), 0)
  assert.equal(growthOf(2, 1), 0.5)      // +50% after smoothing
  assert.equal(growthOf(1, 2), -0.333)   // −33%
})

test('velocity is engagement per hour, null for no hours', () => {
  assert.equal(velocityOf(500, 10), 50)
  assert.equal(velocityOf(500, 0), null)
  assert.equal(velocityOf(Number.NaN, 10), null)
})

test('breakout blends growth, velocity share and spread, capped by confidence', () => {
  const strong = breakoutOf({ growth: 2, velocityShare: 1, subreddits: 5, confidence: 1 })
  assert.equal(strong, 1)
  const none = breakoutOf({ growth: 0, velocityShare: 0, subreddits: 0, confidence: 1 })
  assert.equal(none, 0)
  const thin = breakoutOf({ growth: 2, velocityShare: 1, subreddits: 5, confidence: 0.2 })
  assert.equal(thin, 0.2)
  assert.equal(breakoutOf({ growth: null, velocityShare: 1, subreddits: 5, confidence: 1 }), null)
})

test('status order: building before rising, breakout above all', () => {
  const thresholds = { breakoutInterest: 76, breakoutGrowth: 1, minMentions: 3 }
  assert.equal(statusOf({ growth: 0.1, interest: 60, confidence: 0.3, mentions: 10, thresholds }), 'building')
  assert.equal(statusOf({ growth: 0.1, interest: 60, confidence: 0.9, mentions: 10, thresholds }), 'stable')
  assert.equal(statusOf({ growth: 1.4, interest: 80, confidence: 0.9, mentions: 10, thresholds }), 'breakout')
  assert.equal(statusOf({ growth: 0.4, interest: 65, confidence: 0.9, mentions: 10, thresholds }), 'rising')
  assert.equal(statusOf({ growth: -0.5, interest: 40, confidence: 0.9, mentions: 10, thresholds }), 'cooling')
  // Too few mentions never reads as rising, however steep.
  assert.equal(statusOf({ growth: 3, interest: 90, confidence: 0.9, mentions: 1, thresholds }), 'building')
})

test('trending score lets a hot quiet topic outrank a big plateau', () => {
  const hot = trendingScore({ interest: 80, growth: 1.4, subreddits: 3, confidence: 0.9 })
  const plateau = trendingScore({ interest: 84, growth: 0, subreddits: 8, confidence: 0.9 })
  assert.ok(hot > plateau, `${hot} should beat ${plateau}`)
})

test('community activity is null without any baseline at all', () => {
  assert.equal(communityActivityScore({
    currentPostsPerDay: 5, baselinePostsPerDay: null,
    engagementPerPost: 100, baselineEngagementPerPost: null, confidence: 1,
  }), null)
  const score = communityActivityScore({
    currentPostsPerDay: 10, baselinePostsPerDay: 5,
    engagementPerPost: 200, baselineEngagementPerPost: 100, confidence: 1,
  })
  assert.ok(score !== null && score > 50 && score <= 100)
})

test('post velocity prefers measured deltas and labels nothing falsely', () => {
  const now = new Date('2026-10-09T12:00:00Z')
  // Two snapshots three hours apart, +600 engagement → 200/hour.
  assert.equal(postVelocity({
    score: 1000, comments: 200, createdUtc: '2026-10-08T00:00:00Z', now,
    previous: { score: 500, comments: 100, capturedAt: '2026-10-09T09:00:00Z' },
  }), 200)
  // One reading: estimated from age (1200 units over 12h → 100/h).
  assert.equal(postVelocity({ score: 1000, comments: 200, createdUtc: '2026-10-09T00:00:00Z', now }), 100)
  // A negative delta (downvote drift) is floored at zero, never negative velocity.
  assert.equal(postVelocity({
    score: 400, comments: 100, createdUtc: '2026-10-08T00:00:00Z', now,
    previous: { score: 500, comments: 100, capturedAt: '2026-10-09T09:00:00Z' },
  }), 0)
  // Future timestamps cannot produce a number.
  assert.equal(postVelocity({ score: 10, comments: 1, createdUtc: '2026-10-10T00:00:00Z', now }), null)
})

test('mean, dailyRate and bucketEdges behave at the edges', () => {
  assert.equal(mean([]), null)
  assert.equal(mean([1, 2, 3]), 2)
  assert.equal(dailyRate(14, 7), 2)
  assert.equal(dailyRate(14, 0), 0)
  const edges = bucketEdges(0, 3000, 3)
  assert.deepEqual(edges, [0, 1000, 2000, 3000])
})
