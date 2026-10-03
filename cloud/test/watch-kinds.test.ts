import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KINDS, KIND_NAMES, readParams, isKind, isQuietHour, due } from '../src/lib/assistant/watch-kinds'

test('only the menu can be watched', () => {
  assert.equal(isKind('questionnaire_answered'), true)
  assert.equal(isKind('earnings_drop'), false, 'the bot already alerts on earnings drops')
  assert.equal(isKind('__proto__'), false)
  assert.deepEqual([...KIND_NAMES].sort(), ['failed_downloads_above', 'plan_not_opened', 'questionnaire_answered', 'questionnaire_opened', 'reel_over_usual', 'week_net_below'])
})

test('numbers are required, bounded and rounded', () => {
  assert.deepEqual(readParams('plan_not_opened', { days: 2 }), { days: 2 })
  assert.ok('error' in readParams('plan_not_opened', {}))
  assert.ok('error' in readParams('plan_not_opened', { days: 30 }))
  assert.deepEqual(readParams('reel_over_usual', { times: 2.34 }), { times: 2.3 })
  assert.ok('error' in readParams('reel_over_usual', { times: 1 }))
  assert.deepEqual(readParams('week_net_below', { usd: '500' }), { usd: 500 })
  assert.ok('error' in readParams('failed_downloads_above', { count: 10, model: 'Snow' }), 'library-wide only')
  assert.deepEqual(readParams('questionnaire_answered', { days: 99 }), {}, 'extra numbers are ignored')
})

test('labels read as plain sentences', () => {
  assert.equal(KINDS.week_net_below.label({ model: 'Snow', usd: 500 }), 'When Snow closes a Monday-Sunday week under $500 OnlyFans net')
  assert.equal(KINDS.questionnaire_answered.label({}), 'When any model finishes the questionnaire')
  assert.match(KINDS.plan_not_opened.label({ days: 1 }), /1 day after/)
})

test('quiet hours are 23:00-09:00 New York', () => {
  const ny = (h: number) => Date.UTC(2026, 9, 3, h + 4) // EDT is UTC-4
  assert.equal(isQuietHour(ny(8)), true)
  assert.equal(isQuietHour(ny(9)), false)
  assert.equal(isQuietHour(ny(22)), false)
  assert.equal(isQuietHour(ny(23) - 1), false)
  assert.equal(isQuietHour(ny(23)), true)
})

test('each kind is checked no more often than it is worth', () => {
  const now = 10 * 60 * 60_000
  assert.equal(due(null, 'week_net_below', now), true)
  assert.equal(due(now - 59 * 60_000, 'week_net_below', now), false)
  assert.equal(due(now - 60 * 60_000, 'week_net_below', now), true)
  assert.equal(due(now - 5 * 60_000, 'questionnaire_answered', now), true)
})
