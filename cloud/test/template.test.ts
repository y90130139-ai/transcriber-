// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/template.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTemplate, suggestedTemplate, TEMPLATE_TEXT, WINNING_MIN } from '../src/lib/template'

test('the ladder: nothing yet means sprint', () => {
  assert.equal(suggestedTemplate(0, 0), 'sprint')
  assert.equal(suggestedTemplate(0, 1), 'sprint')
})

test('first signal graduates to the mix', () => {
  assert.equal(suggestedTemplate(1, 0), 'mix')
  assert.equal(suggestedTemplate(2, 5), 'mix')
})

test('three winners unlock winning verticals', () => {
  assert.equal(suggestedTemplate(WINNING_MIN, 2), 'winning')
  assert.equal(suggestedTemplate(7, 0), 'winning')
})

test('sent weeks without winners stay on the mix — a sprint is a start, not a demotion', () => {
  assert.equal(suggestedTemplate(0, 2), 'mix')
  assert.equal(suggestedTemplate(0, 10), 'mix')
})

test('isTemplate is a strict gate and custom is never suggested', () => {
  assert.equal(isTemplate('custom'), true)
  assert.equal(isTemplate('Sprint'), false)
  assert.equal(isTemplate(null), false)
  for (let winners = 0; winners < 6; winners += 1) {
    for (let sent = 0; sent < 6; sent += 1) {
      assert.notEqual(suggestedTemplate(winners, sent), 'custom')
    }
  }
})

test('every template has a label and a line', () => {
  for (const text of Object.values(TEMPLATE_TEXT)) {
    assert.ok(text.label.length > 0)
    assert.ok(text.line.length > 0)
  }
})
