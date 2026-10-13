// node --import ./test/ts-resolve.mjs --test test/reddit-discovery.test.ts
//
// The sweep's planning rules, tested without a database or a network:
//   - the keyword cursor rotates and wraps, so the hunt never runs dry
//   - only genuinely adult-facing communities big enough to matter pass
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptCandidate, nextKeywords, NSFW_KEYWORDS, splitDiscoveryBudget } from '../src/lib/reddit/discovery'

test('the keyword list is long, unique and lower-cased', () => {
  assert.ok(NSFW_KEYWORDS.length >= 50)
  const seen = new Set(NSFW_KEYWORDS)
  assert.equal(seen.size, NSFW_KEYWORDS.length)
  for (const keyword of NSFW_KEYWORDS) {
    assert.equal(keyword, keyword.toLowerCase())
    assert.ok(keyword.trim().length > 0)
  }
})

test('the cursor rotates through the list and wraps around', () => {
  const first = nextKeywords(0, 5)
  assert.deepEqual(first.keywords, NSFW_KEYWORDS.slice(0, 5))
  assert.equal(first.nextCursor, 5)

  const wrapped = nextKeywords(NSFW_KEYWORDS.length - 2, 5)
  assert.equal(wrapped.keywords.length, 5)
  assert.deepEqual(wrapped.keywords.slice(0, 2), NSFW_KEYWORDS.slice(-2))
  assert.deepEqual(wrapped.keywords.slice(2), NSFW_KEYWORDS.slice(0, 3))
  assert.equal(wrapped.nextCursor, 3)

  const big = nextKeywords(3, NSFW_KEYWORDS.length * 2)
  assert.equal(big.keywords.length, NSFW_KEYWORDS.length)
})

test('spent keywords are clamped away', () => {
  assert.equal(nextKeywords(0, 0).keywords.length, 1)
})

test('only adult-facing communities above the floor pass', () => {
  const min = 500
  // Flagged 18+ and big enough: accepted.
  assert.ok(acceptCandidate({ name: 'nsfwfun', subscribers: 5000, over18: true, description: null }, min))
  // Too small: rejected, whatever the flags say.
  assert.ok(!acceptCandidate({ name: 'nsfwfun', subscribers: 499, over18: true, description: null }, min))
  // Unflagged, but the name says what it is: accepted.
  assert.ok(acceptCandidate({ name: 'gonewildcurvy', subscribers: 90000, over18: false, description: null }, min))
  // Unflagged and no adult token anywhere: rejected.
  assert.ok(!acceptCandidate({ name: 'gardening', subscribers: 90000, over18: false, description: 'Plants, mostly.' }, min))
  // The description can carry the token when the name does not.
  assert.ok(acceptCandidate({ name: 'creatorhub', subscribers: 90000, over18: false, description: 'OnlyFans promo home' }, min))
})

test('implausible names are rejected before anything else matters', () => {
  const min = 0
  assert.ok(!acceptCandidate({ name: 'ab', subscribers: 999999, over18: true, description: null }, min))
  assert.ok(!acceptCandidate({ name: 'this-name-is-way-too-long-for-reddit', subscribers: 999999, over18: true, description: null }, min))
  assert.ok(!acceptCandidate({ name: 'not a name', subscribers: 999999, over18: true, description: null }, min))
})

test('the budget splits while hunting and all-scans once the board cap is reached', () => {
  // Below the cap: the configured share scans, the rest hunts.
  assert.deepEqual(splitDiscoveryBudget(100, 100, 500, 50), { content: 50, search: 50 })
  assert.deepEqual(splitDiscoveryBudget(25, 100, 500, 40), { content: 10, search: 15 })
  // At or past the cap: hunting stops entirely.
  assert.deepEqual(splitDiscoveryBudget(100, 500, 500, 50), { content: 100, search: 0 })
  assert.deepEqual(splitDiscoveryBudget(100, 800, 500, 50), { content: 100, search: 0 })
  // A cap of 0 means no cap: the share always applies.
  assert.deepEqual(splitDiscoveryBudget(100, 10000, 0, 50), { content: 50, search: 50 })
})

test('the split never loses or invents requests', () => {
  for (const budget of [1, 7, 25, 200]) {
    for (const percent of [0, 25, 50, 75, 100]) {
      const split = splitDiscoveryBudget(budget, 10, 500, percent)
      assert.equal(split.content + split.search, budget, `budget ${budget} @ ${percent}%`)
      assert.ok(split.content >= 0 && split.search >= 0)
    }
  }
  assert.deepEqual(splitDiscoveryBudget(0, 0, 0, 50), { content: 0, search: 0 })
})
