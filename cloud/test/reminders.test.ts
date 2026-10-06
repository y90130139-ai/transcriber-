// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/reminders.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nudgeWindow, nudgeCounts, nudgeDue, currentWeekOf } from '../src/lib/reminders'

// 2026-10-07 is a Wednesday, 2026-10-10 a Saturday. 17:00 ET = 21:00 UTC (EDT).
const WED_5PM_ET = Date.parse('2026-10-07T21:00:00Z')
const SAT_NOON_ET = Date.parse('2026-10-10T16:00:00Z')
const MONDAY_9AM_ET = Date.parse('2026-10-05T13:00:00Z')

const item = (over: Partial<{ mine: boolean; filmed: boolean; verdict: 'accepted' | 'declined' | 'open'; made_at: string | null }>) =>
  ({ mine: false, filmed: false, verdict: 'open' as const, made_at: null, ...over })

test('the windows know their own hours', () => {
  assert.equal(nudgeWindow(WED_5PM_ET), 'midweek')
  assert.equal(nudgeWindow(SAT_NOON_ET), 'lastcall')
  assert.equal(nudgeWindow(MONDAY_9AM_ET), null)
  // Wednesday morning is not the window — 16:00 is.
  assert.equal(nudgeWindow(Date.parse('2026-10-07T13:00:00Z')), null)
})

test('counts match her page header: hers to film only', () => {
  const counts = nudgeCounts([
    item({}),
    item({ filmed: true }),
    item({ verdict: 'declined' }), // left her feed
    item({ mine: true }), // her own reel, never counted
    item({ made_at: '2026-10-01' }), // made already = a yes, not a chore
  ])
  assert.deepEqual(counts, { filmed: 1, left: 1, total: 2 })
})

test('midweek only nags at zero filmed; lastcall whenever cards remain', () => {
  assert.equal(nudgeDue('midweek', { filmed: 0, left: 5 }), true)
  assert.equal(nudgeDue('midweek', { filmed: 2, left: 3 }), false) // she is working
  assert.equal(nudgeDue('lastcall', { filmed: 2, left: 3 }), true)
  assert.equal(nudgeDue('lastcall', { filmed: 5, left: 0 }), false)
  assert.equal(nudgeDue('midweek', { filmed: 0, left: 0 }), false)
})

test('the week is the ET Monday, even late on Sunday night UTC', () => {
  assert.equal(currentWeekOf(WED_5PM_ET), '2026-10-05')
  // 01:00 UTC Monday is still Sunday evening in New York.
  assert.equal(currentWeekOf(Date.parse('2026-10-12T01:00:00Z')), '2026-10-05')
  assert.equal(currentWeekOf(Date.parse('2026-10-12T13:00:00Z')), '2026-10-12')
})
