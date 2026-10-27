import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalFor, isRetiredHost, LIVE_ORIGIN, RETIRED_HOSTS } from '../src/lib/retired-host'

const VERCEL = 'transcriber-ten-zeta.vercel.app'
const PREVIEW = 'transcriber-fnrkthi0y-sinauraco-s-projects.vercel.app'

test('both retired aliases hand a plan link over, with its week', () => {
  assert.deepEqual(
    RETIRED_HOSTS.map((host) => canonicalFor(host, '/p/3zbNqeTkPw', '?week=2026-10-26')),
    RETIRED_HOSTS.map(() => 'https://plan.gosianmedia.com/p/3zbNqeTkPw?week=2026-10-26'),
  )
  assert.deepEqual([...RETIRED_HOSTS], [
    'transcriber-ten-zeta.vercel.app',
    'transcriber-sinauraco-s-projects.vercel.app',
  ])
})

test('the links the bot and the models actually hold map one to one', () => {
  const paths = ['/', '/e/abc123XYZ', '/models/helwife', '/models/helwife/week/2026-10-26', '/join']
  assert.deepEqual(
    paths.map((path) => canonicalFor(VERCEL, path, '')),
    paths.map((path) => `${LIVE_ORIGIN}${path}`),
  )
})

test('every query parameter survives, in its original order', () => {
  assert.equal(
    canonicalFor(VERCEL, '/models/helwife', '?week=2026-10-26&tab=library&q=a%20b'),
    'https://plan.gosianmedia.com/models/helwife?week=2026-10-26&tab=library&q=a%20b',
  )
})

test('the API is left where the bot calls it, so no redirect can strip its token', () => {
  for (const path of [
    '/api',
    '/api/worker/claim',
    '/api/bot/plan',
    '/api/app/content',
    '/api/photo/abc',
    '/api/cron/daily',
  ]) {
    assert.equal(canonicalFor(VERCEL, path, '?x=1'), null, path)
  }
})

test('a preview deployment still serves its own pages', () => {
  // The whole point of naming the aliases instead of testing the suffix: a
  // preview URL ends in .vercel.app too, and redirecting it ends preview
  // review on this project.
  assert.equal(isRetiredHost(PREVIEW), false)
  assert.equal(canonicalFor(PREVIEW, '/p/abc', '?week=2026-10-26'), null)
  assert.equal(canonicalFor('transcriber-a3rm9wzyw-sinauraco-s-projects.vercel.app', '/', ''), null)
})

test('the live domain, and any other custom domain, is untouched', () => {
  for (const host of ['plan.gosianmedia.com', 'gosianmedia.com', 'localhost:3000', '', null]) {
    assert.equal(canonicalFor(host, '/p/abc', ''), null, String(host))
  }
})

test('a host that merely resembles a retired alias is not one', () => {
  assert.equal(isRetiredHost('transcriber-ten-zeta.vercel.app.evil.com'), false)
  assert.equal(isRetiredHost('notranscriber-ten-zeta.vercel.app'), false)
  assert.equal(isRetiredHost('vercel.app'), false)
  assert.equal(isRetiredHost('TRANSCRIBER-TEN-ZETA.VERCEL.APP'), true)
  assert.equal(isRetiredHost(`${VERCEL}:443`), true)
})

test('a path that opens with two slashes cannot send anyone off the domain', () => {
  // `new URL('//evil.com/x', LIVE_ORIGIN)` would resolve to evil.com outright.
  for (const path of ['//evil.com/x', '/\\evil.com', '///evil.com']) {
    const target = canonicalFor(VERCEL, path, '')
    assert.ok(target?.startsWith(`${LIVE_ORIGIN}/`), `${path} -> ${target}`)
    assert.equal(new URL(target!).host, 'plan.gosianmedia.com')
  }
})
