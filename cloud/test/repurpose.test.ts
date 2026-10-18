// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/repurpose.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { r2KeyForRepurposed } from '../src/lib/r2'

test('a repurposed output lives outside the plans/ sweep', () => {
  const key = r2KeyForRepurposed('model123456', 'job12345678')
  assert.equal(key, 'repurposed/model123456/job12345678.mp4')
  // The retention sweep and the bucket reconcile only ever list `plans/`.
  // A key inside it would be reclaimed while a row still points at it, and a
  // key that changes per render would orphan the copy before it.
  assert.ok(!key.startsWith('plans/'))
})

test('the key is stable per job, so a re-render replaces in place', () => {
  assert.equal(
    r2KeyForRepurposed('model123456', 'job12345678'),
    r2KeyForRepurposed('model123456', 'job12345678'),
  )
  assert.notEqual(
    r2KeyForRepurposed('model123456', 'job12345678'),
    r2KeyForRepurposed('model123456', 'job87654321'),
  )
})

test('ids that are not path-safe cannot escape their folder', () => {
  const key = r2KeyForRepurposed('../evil/../model', 'job/../../9')
  assert.equal(key, 'repurposed/evilmodel/job9.mp4')
  assert.ok(!key.includes('..'))
})
