// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/funnel.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actions, type Money, type Reading } from '../src/lib/funnel-rank'

const reading = (over: Partial<Reading>): Reading => ({
  handle: 'someone', state: 'red', bio_url: null, has_story: false,
  highlights: 0, followers: 1000, creator: 'Someone FS',
  read_at: '2026-10-28T06:00:00Z', was: null, ...over,
})

const money = (over: Partial<Money> & { creator: string }): Money => ({
  chat: false, tier: 'out', sep_full: 0, oct_net: 0, gap: 0,
  week_now: 0, week_peak: 0, ...over,
})

test('three dark accounts belonging to one model are one thing to do', () => {
  const rows = [
    reading({ handle: 'realninadolci', creator: 'Nina Dolci', followers: 502_524 }),
    reading({ handle: 'ninadolcixoxo', creator: 'Nina Dolci', followers: 3_276 }),
    reading({ handle: 'sabrina_sidoti', creator: 'Nina Dolci', state: 'amber', followers: 1_000 }),
  ]

  const out = actions(rows, { 'Nina Dolci': money({ creator: 'Nina Dolci' }) })

  assert.equal(out.length, 1, 'one conversation, not three')
  assert.deepEqual(out[0].handles, ['realninadolci', 'ninadolcixoxo'])
  assert.equal(out[0].kind, 'dark')
  assert.equal(out[0].followers, 506_800)
})

test('a link that vanished overnight outranks one dark for a month', () => {
  // The fresh one is worth far less money and still goes first: she can still
  // remember doing it, which is what makes the ask land.
  const rows = [
    reading({ handle: 'longgone', creator: 'Big FS', followers: 500_000 }),
    reading({ handle: 'justlost', creator: 'Small FS', state: 'amber', was: 'green', followers: 900 }),
  ]
  const m = {
    'Big FS': money({ creator: 'Big FS', week_peak: 900_000, week_now: 100_000 }),
    'Small FS': money({ creator: 'Small FS', week_peak: 20_000, week_now: 19_000 }),
  }

  const out = actions(rows, m)

  assert.equal(out[0].creator, 'Small FS')
  assert.equal(out[0].kind, 'lost')
  assert.equal(out[1].creator, 'Big FS')
})

test('within a kind the ranking is money, not audience', () => {
  const rows = [
    reading({ handle: 'huge', creator: 'Quiet FS', followers: 2_000_000 }),
    reading({ handle: 'small', creator: 'Earner FS', followers: 4_000 }),
  ]
  const m = {
    'Quiet FS': money({ creator: 'Quiet FS', week_peak: 1_000, week_now: 900 }),
    'Earner FS': money({ creator: 'Earner FS', week_peak: 600_000, week_now: 200_000 }),
  }

  const out = actions(rows, m)

  assert.equal(out[0].creator, 'Earner FS')
  assert.equal(out[0].lostPerWeek, 400_000)
})

test('an account with a live link is nothing to do', () => {
  const rows = [reading({ handle: 'fine', creator: 'Fine FS', state: 'green' })]
  assert.deepEqual(actions(rows, {}), [])
})

test('an unread account is not treated as a dark one', () => {
  // "We could not read her bio" and "she has no link" are different answers,
  // and acting on the first is how a model gets asked about nothing.
  const rows = [reading({ handle: 'unread', creator: 'Unread FS', state: 'unknown' })]
  assert.deepEqual(actions(rows, {}), [])
})

test('a chat client is routed to Patricia, never messaged as a creator', () => {
  const rows = [reading({ handle: 'hers', creator: 'Alice CHAT' })]

  const out = actions(rows, { 'Alice CHAT': money({ creator: 'Alice CHAT', chat: true }) })

  assert.equal(out[0].owner, 'Patricia')
})

test('a creator with no money row still appears, ranked last rather than dropped', () => {
  const rows = [
    reading({ handle: 'known', creator: 'Known FS' }),
    reading({ handle: 'nomoney', creator: 'Unmatched FS' }),
  ]

  const out = actions(rows, { 'Known FS': money({ creator: 'Known FS', week_peak: 5_000, week_now: 1_000 }) })

  assert.equal(out.length, 2)
  assert.equal(out[0].creator, 'Known FS')
  assert.equal(out[1].lostPerWeek, 0)
})
