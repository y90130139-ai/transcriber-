// node --import ./test/ts-resolve.mjs --test test/stories.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeStoryCadence, standingFor, STORY_CADENCE, type StoryStanding } from '../src/lib/performance/stories'

const model = (name: string, days: number, observed: number, handles = ['her']) =>
  ({ name, handles, story_days: days, story_days_observed: observed })

const standings = (...rows: ReturnType<typeof model>[]) =>
  rows.map(standingFor).filter((s): s is StoryStanding => s !== null)

test('the thresholds are the ones Geno asked for', () => {
  assert.deepEqual([STORY_CADENCE.strong, STORY_CADENCE.slipping, STORY_CADENCE.windowDays], [0.8, 0.5, 7])
})

test('a model lands in the bucket her share puts her in', () => {
  assert.equal(standingFor(model('Juno', 7, 7))?.bucket, 'strong')
  assert.equal(standingFor(model('Helena', 6, 7))?.bucket, 'strong', '86% is keeping it up')
  assert.equal(standingFor(model('Bella', 4, 7))?.bucket, 'steady', '57% is neither, and says nothing')
  assert.equal(standingFor(model('Mia', 3, 7))?.bucket, 'slipping', '43% is under half')
  assert.equal(standingFor(model('Rose', 0, 7))?.bucket, 'silent')
  // Exactly on a threshold counts as the better side of it.
  assert.equal(standingFor(model('Edge', 4, 5))?.bucket, 'strong', '80% exactly is strong')
  assert.equal(standingFor(model('Half', 1, 2, ['x']))?.bucket, 'unknown', 'two readings say nothing yet')
})

test('a model with no Instagram handle is left out, not called silent', () => {
  assert.equal(standingFor(model('Nobody', 0, 0, [])), null)
})

test('fewer than three readings is "too new to say", never a confident zero', () => {
  const s = standingFor(model('Fresh', 0, 2))
  assert.equal(s?.bucket, 'unknown')
  assert.equal(s?.share, null)
})

test('the message leads with who is slipping, names nothing-at-all first, then who kept it up', () => {
  const text = composeStoryCadence(standings(
    model('Juno', 7, 7), model('Rose', 0, 7), model('Mia', 2, 7), model('Bella', 4, 7), model('Fresh', 1, 2),
  ), 'last 7 days')
  assert.equal(text, [
    '📱 INSTAGRAM STORIES — last 7 days',
    '',
    '🔴 Slipping (under 50%)',
    '   Rose — nothing at all, 0 of 7 days',
    '   Mia — 2 of 7 days (29%)',
    '',
    '🟢 Keeping it up (80%+)',
    '   Juno — 7 of 7 days (100%)',
    '',
    '⏳ Too new to say: Fresh',
  ].join('\n'))
  assert.doesNotMatch(text as string, /Bella/, '57% is nobody\'s business either way')
})

test('nothing to praise and nobody slipping sends nothing at all', () => {
  assert.equal(composeStoryCadence(standings(model('Bella', 4, 7)), 'last 7 days'), null)
  assert.equal(composeStoryCadence(standings(model('Fresh', 1, 2)), 'last 7 days'), null, 'unknowns alone are not a message')
  assert.equal(composeStoryCadence([], 'last 7 days'), null)
})

test('each list is worst-first and best-first, so the eye lands on the right name', () => {
  const text = composeStoryCadence(standings(
    model('Betta', 3, 7), model('Worse', 1, 7), model('Good', 6, 7), model('Best', 7, 7),
  ), 'last 7 days') as string
  assert.ok(text.indexOf('Worse') < text.indexOf('Betta'), 'the worst slipper is named first')
  assert.ok(text.indexOf('Best') < text.indexOf('Good'), 'the strongest is named first')
})
