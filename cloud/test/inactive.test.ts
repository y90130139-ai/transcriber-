// node --import ./test/ts-resolve.mjs --test test/inactive.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readActiveChange, reasonLabel } from '../src/lib/inactive'

test('reactivating needs nothing else', () => {
  assert.deepEqual(readActiveChange({ active: true, reason: 'left' }), { active: true })
})

test('deactivating needs a known reason; the note is trimmed and optional', () => {
  assert.deepEqual(readActiveChange({ active: false, reason: 'left', note: '  moved to another agency ' }), { active: false, reason: 'left', note: 'moved to another agency' })
  assert.deepEqual(readActiveChange({ active: false, reason: 'unresponsive' }), { active: false, reason: 'unresponsive', note: null })
  assert.ok('error' in readActiveChange({ active: false }))
  assert.ok('error' in readActiveChange({ active: false, reason: 'fired' }))
  assert.ok('error' in readActiveChange({ active: 'no' }))
  assert.ok('error' in readActiveChange(null))
})

test('"other" must say what', () => {
  assert.ok('error' in readActiveChange({ active: false, reason: 'other', note: '   ' }))
  assert.deepEqual(readActiveChange({ active: false, reason: 'other', note: 'on maternity leave' }), { active: false, reason: 'other', note: 'on maternity leave' })
})

test('labels read as words, unknown falls back', () => {
  assert.equal(reasonLabel('left'), 'Left')
  assert.equal(reasonLabel(null), 'Inactive')
})
