// node --import ./test/ts-resolve.mjs --test test/reddit-schedule.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TARGETS,
  dueAt,
  effectiveIntervalMinutes,
  sampleFleet,
  simulateDay,
  spreadFactor,
  type SchedulerOptions,
} from '../src/lib/reddit/schedule'

const FLEET = sampleFleet(1000)
// A 1,000-community fleet is past the big-fleet line, so a fetch is one
// listing — exactly what collect.ts chooses at that scale. Budget: the
// spec's 5,000/day at 5 requests per minute.
const NORMAL: SchedulerOptions = {
  listingsPerFetch: 1,
  dailyCap: 5000,
  requestsPerMinute: 5,
}

/** The projection report, printed once so the numbers live with the tests. */
test('projection report: 1,000 communities over 24 hours', () => {
  const result = simulateDay(FLEET, NORMAL)
  const high = [...result.fetches.entries()].filter(([id]) => FLEET.find((sub) => sub.id === id)?.priority === 'high')
  const low = [...result.fetches.entries()].filter(([id]) => FLEET.find((sub) => sub.id === id)?.priority === 'low')
  const avg = (rows: [string, number][]) => rows.length ? (rows.reduce((total, [, n]) => total + n, 0) / rows.length).toFixed(2) : '0'
  const line = [
    `requests=${result.requests}/5000`,
    `communities=${FLEET.length}`,
    `uncovered=${result.uncovered.length}`,
    `coverage=${result.coverageMinutes}min`,
    `peakHour=${Math.max(...result.hourly)}`,
    `high avg fetches=${avg(high)}`,
    `low avg fetches=${avg(low)}`,
    `capHit=${result.capHit}`,
  ].join(' · ')
  console.log(`  [capacity] ${line}`)
  assert.ok(result.requests > 0)
})

test('all 1,000 communities are covered inside 24 hours under the normal budget', () => {
  const result = simulateDay(FLEET, NORMAL)
  assert.equal(result.uncovered.length, 0, `uncovered: ${result.uncovered.slice(0, 5).join(', ')}`)
  assert.ok(result.coverageMinutes !== null && result.coverageMinutes < 24 * 60)
  assert.ok(result.requests <= NORMAL.dailyCap)
  assert.equal(result.capHit, false)
})

test('the throttle holds: no hour exceeds requests_per_minute × 60', () => {
  const result = simulateDay(FLEET, NORMAL)
  assert.ok(Math.max(...result.hourly) <= NORMAL.requestsPerMinute * 60, `peak ${Math.max(...result.hourly)}`)
})

test('fair scheduling: busy communities get extra refreshes, quiet ones are never starved', () => {
  const result = simulateDay(FLEET, NORMAL)
  const byPriority = { high: [] as number[], medium: [] as number[], low: [] as number[] }
  for (const sub of FLEET) byPriority[sub.priority].push(result.fetches.get(sub.id) ?? 0)
  const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length
  // Every community, however quiet, was fetched at least once…
  assert.ok(Math.min(...byPriority.low) >= 1)
  assert.ok(Math.min(...byPriority.medium) >= 1)
  assert.ok(Math.min(...byPriority.high) >= 1)
  // …and the busy tiers got more.
  assert.ok(average(byPriority.high) > average(byPriority.low))
})

test('due order is fair: a waited quiet community is served before a fresh busy one', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const quietWaited = dueAt({ id: 'quiet', priority: 'low', activity: 5, lastSyncedAt: now - 26 * 3_600_000 }, now)
  const busyFresh = dueAt({ id: 'busy', priority: 'high', activity: 400, lastSyncedAt: now - 30 * 60_000 }, now)
  assert.ok(quietWaited < busyFresh, `${quietWaited} should come before ${busyFresh}`)
})

test('the default cadence is daily, twice a day for high priority', () => {
  assert.equal(effectiveIntervalMinutes({ priority: 'high', activity: 0 }), 720)
  assert.equal(effectiveIntervalMinutes({ priority: 'medium', activity: 0 }), 1440)
  assert.equal(effectiveIntervalMinutes({ priority: 'low', activity: 0 }), 1440)
})

test('activity shortens the interval gently — a scan still means tomorrow', () => {
  assert.equal(effectiveIntervalMinutes({ priority: 'high', activity: 150 }), 576)   // 0.8×
  assert.equal(effectiveIntervalMinutes({ priority: 'medium', activity: 40 }), 1296) // 0.9×
  // Never longer than a day, never shorter than 15 minutes.
  assert.ok(effectiveIntervalMinutes({ priority: 'low', activity: 0 }, { high: 720, medium: 1440, low: 4320 }) <= 1440)
  assert.ok(effectiveIntervalMinutes({ priority: 'high', activity: 9999 }, { high: 20, medium: 720, low: 1440 }) >= 15)
})

test('due times spread across the interval — no fleet-wide wave', () => {
  const factors = ['creators', 'tiktok', 'legalteens', 'saas', 'youtube', 'onlyfans', 'gaming', 'artificial']
    .map((id) => spreadFactor(id))
  for (const factor of factors) assert.ok(factor >= 0.8 && factor <= 0.95, `factor ${factor}`)
  // Stable: the same community always spreads the same way.
  assert.equal(spreadFactor('legalteens'), spreadFactor('legalteens'))
  // And the fleet is not all at one point.
  assert.ok(new Set(factors).size > 1)
})

test('daily cap exhaustion stops the schedule and reports what is left', () => {
  const result = simulateDay(FLEET, { ...NORMAL, dailyCap: 500 })
  assert.equal(result.capHit, true)
  assert.ok(result.requests <= 500)
  assert.ok(result.uncovered.length > 0)
})

test('failures cost requests and are retried without breaking the ceiling', () => {
  // A smaller fleet so the day is demand-bound, not capacity-bound — that
  // is the only way retries are visible as extra requests. Small fleets
  // keep the richer listings.
  const small = sampleFleet(200)
  const options: SchedulerOptions = { ...NORMAL, listingsPerFetch: 2, dailyCap: 20_000 }
  const clean = simulateDay(small, options)
  const messy = simulateDay(small, options, 0.2)
  // Every failed attempt spends budget like the real client counts it.
  assert.ok(messy.requests > clean.requests, `${messy.requests} should exceed ${clean.requests}`)
  assert.ok(messy.requests <= 20_000)
  // With the extra headroom the day still covers everyone.
  assert.equal(messy.uncovered.length, 0)
})

test('a restarted scheduler resumes and covers the next day again', () => {
  const day1 = simulateDay(FLEET, NORMAL)
  assert.equal(day1.uncovered.length, 0)
  const endOfDay = 86_400_000
  const fleet2 = FLEET.map((sub, index) => ({
    ...sub,
    // Steady state: last syncs carry the same spread into day 2 that they
    // had at the start of day 1 (a restart loses nothing — it is all in
    // last_synced_at).
    lastSyncedAt: sub.lastSyncedAt === null ? null : endOfDay - (1 + (index % 19)) * 3_600_000,
  }))
  const day2 = simulateDay(fleet2, NORMAL)
  assert.equal(day2.uncovered.length, 0)
  assert.ok(day2.requests <= NORMAL.dailyCap)
})

test('no target interval exceeds a day, so daily coverage is structural', () => {
  for (const minutes of Object.values(DEFAULT_TARGETS)) assert.ok(minutes <= 1440)
})
