// node --import ./test/ts-resolve.mjs --test test/reddit-client.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  backoffDelay,
  classifyAboutFailure,
  CIRCUIT_THRESHOLD,
  createRedditClient,
  nextDelayMs,
  parseRateLimitHeaders,
  RedditBudgetError,
  RedditCircuitError,
  RedditHttpError,
  retryAfterSeconds,
} from '../src/lib/reddit/client'

test('backoff grows exponentially, carries jitter and never collapses', () => {
  const noJitter = () => 0.5 // zero jitter
  assert.equal(backoffDelay(0, 500, 15_000, noJitter), 500)
  assert.equal(backoffDelay(1, 500, 15_000, noJitter), 1000)
  assert.equal(backoffDelay(2, 500, 15_000, noJitter), 2000)
  assert.equal(backoffDelay(10, 500, 15_000, noJitter), 15_000) // cap
  const jittered = backoffDelay(2, 500, 15_000, () => 1) // +25%
  assert.ok(jittered > 2000 && jittered <= 2500)
  assert.ok(backoffDelay(0, 500, 15_000, () => 0) >= 100) // floor
})

test('rate-limit headers parse, tolerating missing and malformed values', () => {
  const headers = new Map([
    ['x-ratelimit-remaining', '42.5'],
    ['x-ratelimit-used', '17'],
    ['x-ratelimit-reset', '360'],
  ])
  const state = parseRateLimitHeaders((name) => headers.get(name) ?? null, 1000)
  assert.equal(state.remaining, 42.5)
  assert.equal(state.used, 17)
  assert.equal(state.resetSeconds, 360)
  assert.equal(state.at, 1000)

  const empty = parseRateLimitHeaders(() => null)
  assert.deepEqual({ remaining: empty.remaining, used: empty.used, resetSeconds: empty.resetSeconds }, { remaining: null, used: null, resetSeconds: null })
  const broken = parseRateLimitHeaders((name) => (name === 'x-ratelimit-remaining' ? 'not-a-number' : ' '))
  assert.equal(broken.remaining, null)
  assert.equal(broken.used, null)
})

test('Retry-After accepts seconds and dates, capped', () => {
  assert.equal(retryAfterSeconds('5'), 5)
  assert.equal(retryAfterSeconds('0'), 0)
  assert.equal(retryAfterSeconds('9999'), 60)
  const now = Date.parse('2026-10-09T12:00:00Z')
  assert.equal(retryAfterSeconds('Fri, 09 Oct 2026 12:00:30 GMT', now), 30)
  assert.equal(retryAfterSeconds('garbage', now), null)
  assert.equal(retryAfterSeconds(null), null)
})

test('nextDelayMs paces from the headers at the safety ratio', () => {
  const now = 1_000_000
  // 100 seconds of quota left, reset in 100s, 50% safety → 2s between calls.
  const paced = nextDelayMs(
    { remaining: 100, used: 0, resetSeconds: 100, at: now },
    { minIntervalMs: 1000, safetyRatio: 0.5, now },
  )
  assert.equal(paced, 2000)
  // Floor wins when the headers say go faster.
  const floored = nextDelayMs(
    { remaining: 600, used: 0, resetSeconds: 600, at: now },
    { minIntervalMs: 1100, safetyRatio: 1, now },
  )
  assert.equal(floored, 1100)
  // Nearly exhausted: wait out the window rather than spend the last drops.
  const drained = nextDelayMs(
    { remaining: 1, used: 599, resetSeconds: 30, at: now },
    { minIntervalMs: 1000, safetyRatio: 0.5, now },
  )
  assert.equal(drained, 30_000)
  // No headers at all: just the floor.
  const blind = nextDelayMs(
    { remaining: null, used: null, resetSeconds: null, at: now },
    { minIntervalMs: 1100, safetyRatio: 0.5, now },
  )
  assert.equal(blind, 1100)
})

test('about failures classify into truthful statuses', () => {
  assert.equal(classifyAboutFailure(404).status, 'unavailable')
  assert.equal(classifyAboutFailure(403).status, 'restricted')
  assert.equal(classifyAboutFailure(403, 'this community is quarantined').status, 'quarantined')
  assert.equal(classifyAboutFailure(451).status, 'unavailable')
  assert.equal(classifyAboutFailure(500).status, 'error')
})

test('the client never fires more requests than its budget', async () => {
  let calls = 0
  const fetchImpl: typeof fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'x-ratelimit-remaining': '100', 'x-ratelimit-used': String(calls), 'x-ratelimit-reset': '600' },
    })
  }
  // Provide a token without hitting the network.
  process.env.REDDIT_CLIENT_ID = 'test-id'
  process.env.REDDIT_CLIENT_SECRET = 'test-secret'
  const tokenFetch: typeof fetch = async (input, init) => {
    if (String(input).includes('access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    return fetchImpl(input, init)
  }
  const client = createRedditClient({ budget: 2, minIntervalMs: 0, fetchImpl: tokenFetch })
  await client.get('/r/a/about')
  await client.get('/r/b/about')
  await assert.rejects(() => client.get('/r/c/about'), RedditBudgetError)
  assert.equal(calls, 2)
})

test('the client stops after repeated 429s (circuit breaker)', async () => {
  process.env.REDDIT_CLIENT_ID = 'test-id'
  process.env.REDDIT_CLIENT_SECRET = 'test-secret'
  let calls = 0
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    calls += 1
    return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
  }
  const client = createRedditClient({ budget: 50, minIntervalMs: 0, fetchImpl })
  await assert.rejects(() => client.get('/r/a/new'), RedditHttpError)
  await assert.rejects(() => client.get('/r/b/new'), RedditHttpError)
  await assert.rejects(() => client.get('/r/c/new'), RedditCircuitError)
  assert.ok(calls <= CIRCUIT_THRESHOLD + 3, `calls=${calls}`)
  assert.equal(client.stats().circuitOpen, true)
})

test('the same URL twice in one run is one request (deduplication)', async () => {
  process.env.REDDIT_CLIENT_ID = 'test-id'
  process.env.REDDIT_CLIENT_SECRET = 'test-secret'
  let calls = 0
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ n: calls }), { status: 200 })
  }
  const client = createRedditClient({ budget: 10, minIntervalMs: 0, fetchImpl })
  const [a, b] = await Promise.all([client.get('/r/a/new'), client.get('/r/a/new')])
  assert.deepEqual(a, b)
  assert.equal(calls, 1)
})

test('the per-request guard stops the client the moment it refuses', async () => {
  process.env.REDDIT_CLIENT_ID = 'test-id'
  process.env.REDDIT_CLIENT_SECRET = 'test-secret'
  let calls = 0
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    calls += 1
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  let checks = 0
  const client = createRedditClient({
    budget: 10,
    minIntervalMs: 0,
    fetchImpl,
    guard: () => { checks += 1; if (checks > 2) throw new Error('cap reached') },
  })
  await client.get('/r/a/new')
  await client.get('/r/b/new')
  await assert.rejects(() => client.get('/r/c/new'), /cap reached/)
  assert.equal(calls, 2)
})

test('a 404 is surfaced, not retried into a loop', async () => {
  process.env.REDDIT_CLIENT_ID = 'test-id'
  process.env.REDDIT_CLIENT_SECRET = 'test-secret'
  let calls = 0
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    calls += 1
    return new Response('not found', { status: 404 })
  }
  const client = createRedditClient({ budget: 10, minIntervalMs: 0, fetchImpl })
  await assert.rejects(() => client.get('/r/missing/about'), (error: unknown) => {
    return error instanceof RedditHttpError && error.status === 404
  })
  assert.equal(calls, 1)
})
