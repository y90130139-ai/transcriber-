// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/plan-buckets.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketOf, splitByBucket, type Bucketed } from '../src/lib/plan-buckets'

const item = (verdict: Bucketed['verdict'], filmed = false): Bucketed => ({ verdict, filmed })

test('an unanswered card waits under To review', () => {
  assert.equal(bucketOf(item('open')), 'review')
})

test('a yes is hers — My reels', () => {
  assert.equal(bucketOf(item('accepted')), 'mine')
})

test('a filmed card is the loudest yes, even unanswered', () => {
  assert.equal(bucketOf(item('open', true)), 'mine')
})

test('a declined card still files under review until the page moves it out', () => {
  // The page filters completed declines into "Videos you can't do" before
  // bucketing; a half-finished decline (reason still being picked) must stay
  // in front of her, which "review" does.
  assert.equal(bucketOf(item('declined')), 'review')
})

test('a declined card she filmed anyway counts as hers', () => {
  assert.equal(bucketOf(item('declined', true)), 'mine')
})

test('splitByBucket keeps each pile in plan order', () => {
  const cards = [
    { id: 'a', ...item('open') },
    { id: 'b', ...item('accepted') },
    { id: 'c', ...item('open') },
    { id: 'd', ...item('open', true) },
  ]
  const piles = splitByBucket(cards)
  assert.deepEqual(piles.review.map((card) => card.id), ['a', 'c'])
  assert.deepEqual(piles.mine.map((card) => card.id), ['b', 'd'])
})
