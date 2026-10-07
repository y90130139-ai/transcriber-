// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/plan-contents.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contentLines } from '../src/lib/plan-contents'

test('counts by primary format, biggest first, taxonomy labels', () => {
  const lines = contentLines([
    { formats: ['skit'] }, { formats: ['skit', 'comedy'] }, { formats: ['skit'] },
    { formats: ['talking-head'] }, { formats: ['talking-head'] },
    { formats: [] },
  ])
  assert.equal(lines[0].count, 3)
  assert.match(lines[0].label.toLowerCase(), /skit/)
  assert.equal(lines[1].count, 2)
  assert.equal(lines[2].label, 'Videos') // no tag is still counted, honestly
})

test('an unknown tag falls back to its id rather than vanishing', () => {
  const lines = contentLines([{ formats: ['not-a-real-tag'] }])
  assert.deepEqual(lines, [{ count: 1, label: 'not-a-real-tag' }])
})
