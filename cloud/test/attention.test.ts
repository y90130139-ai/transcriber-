// node --import ./test/ts-resolve.mjs --test test/attention.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { igCard, igDigest, needsCard, slipped, storyShare, storyGoodNews, STORY, type IgStanding } from '../src/lib/performance/attention'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const m = (over: Partial<IgStanding> = {}): IgStanding => ({
  name: 'Juno', tag: 'average', wasTag: 'average', trend: 'flat', reasons: [],
  followersGain: 100, viewsChange: 0, reelsPerWeek: 14,
  storyDays: 6, storyObserved: 7, lastPostedAt: ago(1), ...over,
})

test('a creator who is fine gets no card at all', () => {
  assert.equal(needsCard(m()), false)
  assert.equal(igCard(m(), NOW), null)
  assert.equal(igDigest([m(), m({ name: 'Helena' })], NOW), null)
})

test('the three things that put her on a card', () => {
  assert.equal(needsCard(m({ tag: 'attention' })), true, 'the dashboard tag')
  assert.equal(needsCard(m({ wasTag: 'top', tag: 'average' })), true, 'slipped from top')
  assert.equal(needsCard(m({ storyDays: 2, storyObserved: 7 })), true, 'stories under half')
  assert.equal(needsCard(m({ trend: 'down', reasons: ['Trending down.'] })), true)
  // Still top, so not slipping, even though last week she was top too.
  assert.equal(slipped(m({ wasTag: 'top', tag: 'top' })), false)
  assert.equal(slipped(m({ wasTag: null, tag: 'average' })), false, 'never seen before is not a slip')
})

test('story share needs three readings before it says anything', () => {
  assert.equal(storyShare(m({ storyDays: 0, storyObserved: 2 })), null)
  assert.equal(storyShare(m({ storyDays: 3, storyObserved: 6 })), 0.5)
  assert.equal(needsCard(m({ storyDays: 0, storyObserved: 2 })), false, 'two readings never flag her')
  assert.equal(needsCard(m({ storyDays: 3, storyObserved: 6 })), false, 'exactly half is not under half')
})

test("one card carries every one of her Instagram signals, in the dashboard's own words", () => {
  const card = igCard(m({
    tag: 'attention', trend: 'down',
    reasons: ['Trending down — views on recent reels are down 42%.', 'Posting 2.0 reels a week — under a quarter of their target of 21.'],
    storyDays: 1, storyObserved: 7, lastPostedAt: ago(9),
  }), NOW)
  assert.equal(card, [
    '📉 Juno — Instagram needs attention',
    '   • Trending down — views on recent reels are down 42%.',
    '   • Posting 2.0 reels a week — under a quarter of their target of 21.',
    '   • Stories on 1 of 7 days (14%).',
    '   • Last posted 9 days ago.',
  ].join('\n'))
})

test('nothing is said twice: trending down and the quiet line defer to the reasons', () => {
  const card = igCard(m({ tag: 'attention', trend: 'down', reasons: ['Trending down — lost 300 followers.', 'Nothing posted in 20 days.'], lastPostedAt: ago(20) }), NOW) as string
  assert.equal(card.match(/Trending down/g)?.length, 1)
  assert.equal(card.match(/posted/gi)?.length, 1, 'the reason already said it')
})

// A slip can be the ONLY thing wrong: her numbers this week look ordinary and
// nothing else flags. Without a line of its own the card was a bare heading
// and got dropped, losing exactly the signal Geno asked for.
test('slipping from the top says so even when nothing else is wrong', () => {
  const card = igCard(m({ wasTag: 'top', tag: 'average' }), NOW) as string
  assert.equal(card, '⬇️ Juno — slipped from Top performer\n   • Was Top performer last week, now average.')
  const quiet = igCard(m({ wasTag: 'top', tag: null }), NOW) as string
  assert.match(quiet, /now too quiet to judge\.$/)
})

test('no stories at all reads differently from a few', () => {
  assert.match(igCard(m({ storyDays: 0, storyObserved: 7 }), NOW) as string, /No stories at all — 0 of 7 days/)
  assert.match(igCard(m({ storyDays: 2, storyObserved: 7 }), NOW) as string, /Stories on 2 of 7 days \(29%\)/)
})

test('the digest puts slipped-from-top first, then needs attention, then the rest', () => {
  const body = igDigest([
    m({ name: 'Cara', storyDays: 1, storyObserved: 7 }),
    m({ name: 'Ava', tag: 'attention', reasons: ['Nothing posted in 30 days.'] }),
    m({ name: 'Bea', wasTag: 'top', tag: 'average', storyDays: 0, storyObserved: 7 }),
  ], NOW) as string
  assert.ok(body.indexOf('Bea') < body.indexOf('Ava'))
  assert.ok(body.indexOf('Ava') < body.indexOf('Cara'))
})

test('who kept stories up is one line of good news, best first', () => {
  const line = storyGoodNews([
    m({ name: 'Juno', storyDays: 6, storyObserved: 7 }),
    m({ name: 'Helena', storyDays: 7, storyObserved: 7 }),
    m({ name: 'Slipping', storyDays: 1, storyObserved: 7 }),
    m({ name: 'TooNew', storyDays: 2, storyObserved: 2 }),
  ])
  assert.equal(line, '🟢 Stories kept up (80%+): Helena 7/7 · Juno 6/7')
  assert.equal(storyGoodNews([m({ storyDays: 1, storyObserved: 7 })]), null)
})

test('the thresholds are the ones Geno set', () => {
  assert.deepEqual([STORY.strong, STORY.slipping, STORY.minObserved], [0.8, 0.5, 3])
})
