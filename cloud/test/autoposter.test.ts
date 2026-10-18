// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/autoposter.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAccount,
  normalizeMedia,
  normalizePost,
  listCalendarAll,
  listPosts,
  resolveWorkspace,
  workspaces,
} from '../src/lib/autoposter'
import { addDaysIso, mondayOf, niceDay, niceRange } from '../src/components/scheduler/schedule-dates'

test('workspaces() reads the comma list, then the legacy single', () => {
  process.env.AUTOPOSTER_WORKSPACES = '  aaa,bbb , aaa,,ccc  '
  delete process.env.AUTOPOSTER_WORKSPACE
  assert.deepEqual(workspaces(), ['aaa', 'bbb', 'ccc'])

  delete process.env.AUTOPOSTER_WORKSPACES
  process.env.AUTOPOSTER_WORKSPACE = 'only'
  assert.deepEqual(workspaces(), ['only'])

  delete process.env.AUTOPOSTER_WORKSPACES
  delete process.env.AUTOPOSTER_WORKSPACE
  assert.deepEqual(workspaces(), [])
})

test('resolveWorkspace prefers the requested one when it is ours', () => {
  process.env.AUTOPOSTER_WORKSPACES = 'aaa,bbb'
  assert.equal(resolveWorkspace('bbb'), 'bbb')
  assert.equal(resolveWorkspace(undefined), 'aaa')
  assert.throws(() => resolveWorkspace('zzz'), /Unknown workspace/)
  delete process.env.AUTOPOSTER_WORKSPACES
  assert.throws(() => resolveWorkspace(undefined), /not connected/)
})

test('an account flattens to id, name, platform and avatar', () => {
  assert.deepEqual(normalizeAccount({ id: 12, username: '@studio', platform: 'Instagram', avatar_url: 'https://x/y.png' }), {
    id: 12,
    uuid: null,
    name: '@studio',
    platform: 'instagram',
    avatar: 'https://x/y.png',
  })
  // Autoposter ships the photo on `image` (and provider, not platform).
  assert.deepEqual(normalizeAccount({
    id: 2149,
    uuid: '714ed546-a1b5-44c6-9567-0d14b85bc849',
    username: 'screamqueensalem',
    provider: 'youtube',
    image: 'https://cdn.example/avatar.jpg',
  }), {
    id: 2149,
    uuid: '714ed546-a1b5-44c6-9567-0d14b85bc849',
    name: 'screamqueensalem',
    platform: 'youtube',
    avatar: 'https://cdn.example/avatar.jpg',
  })
})

test('an account without a usable id is dropped, not rendered empty', () => {
  assert.equal(normalizeAccount({ username: 'nobody' }), null)
  assert.equal(normalizeAccount(null), null)
})

test('a post flattens the documented shape: uuid, date/time, original version, integer accounts', () => {
  const post = normalizePost({
    uuid: 'post-1',
    status: 'Scheduled',
    date: '2026-10-19',
    time: '18:00',
    timezone: 'Europe/London',
    accounts: [12, 47],
    versions: [
      { account_id: 0, is_original: true, content: [{ body: 'Hello', media: [3145, 3146] }] },
      { account_id: 12, is_original: false, content: [{ body: 'Override', media: [] }] },
    ],
  })
  assert.deepEqual(post, {
    id: 'post-1',
    status: 'scheduled',
    date: '2026-10-19',
    time: '18:00',
    timezone: 'Europe/London',
    body: 'Hello',
    mediaCount: 2,
    accountIds: [12, 47],
    title: null,
    kind: 'post',
    platforms: [],
    workspaceId: '',
  })
})

test('a post without an id is dropped, and a body-only post still reads', () => {
  assert.equal(normalizePost({ status: 'draft' }), null)
  assert.deepEqual(normalizePost({ id: 7, status: 'draft' }), {
    id: '7',
    status: 'draft',
    date: null,
    time: null,
    timezone: null,
    body: '',
    mediaCount: 0,
    accountIds: [],
    title: null,
    kind: 'post',
    platforms: [],
    workspaceId: '',
  })
})

test('captions arrive as editor HTML and read as plain text', () => {
  const post = normalizePost({
    uuid: 'p1',
    status: 'published',
    date: '2026-08-09',
    time: '20:00',
    accounts: [1],
    versions: [
      {
        account_id: 0,
        is_original: true,
        content: [{ body: '<div>First line.</div><div>Second &amp; more.</div>', media: [] }],
      },
    ],
  })
  assert.equal(post?.body, 'First line.\nSecond & more.')
})

test('a facebook_page account draws the facebook mark', () => {
  assert.equal(normalizeAccount({ id: 9, username: 'Page', platform: 'facebook_page' })?.platform, 'facebook')
})

test('media needs an integer id; the first URL-ish field wins', () => {
  assert.deepEqual(normalizeMedia({ id: 5, name: 'a.jpg', thumbnail_url: 'https://x/t.jpg' }), {
    id: 5,
    url: 'https://x/t.jpg',
    name: 'a.jpg',
    kind: null,
  })
  assert.equal(normalizeMedia({ name: 'no id' }), null)
})

test('calendar date windows filter locally and reuse the same cached post page', async () => {
  const previousToken = process.env.AUTOPOSTER_TOKEN
  const previousWorkspaces = process.env.AUTOPOSTER_WORKSPACES
  const previousLegacyWorkspace = process.env.AUTOPOSTER_WORKSPACE
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  process.env.AUTOPOSTER_TOKEN = 'test-token'
  process.env.AUTOPOSTER_WORKSPACES = 'calendar-cache-test'
  delete process.env.AUTOPOSTER_WORKSPACE
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    return new Response(JSON.stringify({
      data: [
        { uuid: 'october-post', date: '2026-10-15', status: 'scheduled' },
        { uuid: 'november-post', date: '2026-11-03', status: 'scheduled' },
      ],
      meta: { last_page: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const october = await listPosts('calendar-cache-test', { from: '2026-10-01', to: '2026-10-31' })
    const november = await listPosts('calendar-cache-test', { from: '2026-11-01', to: '2026-11-30' })
    assert.deepEqual(october.map((post) => post.id), ['october-post'])
    assert.deepEqual(november.map((post) => post.id), ['november-post'])
    assert.equal(requests.length, 1)
    assert.match(requests[0], /\/calendar-cache-test\/posts\?page=1$/)
  } finally {
    globalThis.fetch = originalFetch
    if (previousToken === undefined) delete process.env.AUTOPOSTER_TOKEN
    else process.env.AUTOPOSTER_TOKEN = previousToken
    if (previousWorkspaces === undefined) delete process.env.AUTOPOSTER_WORKSPACES
    else process.env.AUTOPOSTER_WORKSPACES = previousWorkspaces
    if (previousLegacyWorkspace === undefined) delete process.env.AUTOPOSTER_WORKSPACE
    else process.env.AUTOPOSTER_WORKSPACE = previousLegacyWorkspace
  }
})

test('calendar reports a rate-limited workspace without retrying the whole workspace repeatedly', async () => {
  const previousToken = process.env.AUTOPOSTER_TOKEN
  const previousWorkspaces = process.env.AUTOPOSTER_WORKSPACES
  const previousLegacyWorkspace = process.env.AUTOPOSTER_WORKSPACE
  const originalFetch = globalThis.fetch
  let requests = 0
  process.env.AUTOPOSTER_TOKEN = 'test-token'
  process.env.AUTOPOSTER_WORKSPACES = 'calendar-rate-limit-test'
  delete process.env.AUTOPOSTER_WORKSPACE
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ message: 'Too Many Attempts' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
    })
  }

  try {
    const result = await listCalendarAll()
    assert.equal(result.loaded, 0)
    assert.deepEqual(result.failed, ['calendar-rate-limit-test'])
    assert.equal(result.errors[0].status, 429)
    assert.match(result.errors[0].message, /rate-limiting/)
    assert.equal(requests, 2)
  } finally {
    globalThis.fetch = originalFetch
    if (previousToken === undefined) delete process.env.AUTOPOSTER_TOKEN
    else process.env.AUTOPOSTER_TOKEN = previousToken
    if (previousWorkspaces === undefined) delete process.env.AUTOPOSTER_WORKSPACES
    else process.env.AUTOPOSTER_WORKSPACES = previousWorkspaces
    if (previousLegacyWorkspace === undefined) delete process.env.AUTOPOSTER_WORKSPACE
    else process.env.AUTOPOSTER_WORKSPACE = previousLegacyWorkspace
  }
})

test('the week math: monday anchoring, stepping, and labels', () => {
  // A Wednesday lands back on its Monday.
  assert.equal(mondayOf(new Date(Date.UTC(2026, 9, 14))), '2026-10-12')
  // A Sunday belongs to the Monday behind it, not the one ahead.
  assert.equal(mondayOf(new Date(Date.UTC(2026, 9, 18))), '2026-10-12')
  assert.equal(addDaysIso('2026-10-12', 6), '2026-10-18')
  assert.equal(addDaysIso('2026-09-30', 1), '2026-10-01')
  assert.equal(niceRange('2026-10-12', '2026-10-18'), '12–18 Oct')
  assert.equal(niceRange('2026-09-28', '2026-10-04'), '28 Sep – 4 Oct')
  assert.equal(niceDay('2026-10-14'), 'Wed 14 Oct')
})
