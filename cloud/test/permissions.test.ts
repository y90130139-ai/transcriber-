// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/permissions.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGES,
  RESTRICTED_PAGE_KEY_SET,
  anyEdit,
  canEdit,
  canView,
  decideApi,
  decidePath,
  firstAllowedPath,
  hasAppAccess,
  pageForPath,
  resolvePermissions,
  sanitizePermissions,
  type AccessLevel,
} from '../src/lib/permissions'
import { SECTIONS, SETTINGS_LEAF } from '../src/components/console/nav'

const edit = (keys: string[]): Record<string, AccessLevel> =>
  Object.fromEntries(PAGES.map((page) => [page.key, keys.includes(page.key) ? 'edit' : 'none'])) as Record<string, AccessLevel>

test('the catalog covers every rail page exactly once', () => {
  const keys = PAGES.map((page) => page.key)
  assert.equal(new Set(keys).size, keys.length)
  const hrefs = PAGES.map((page) => page.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
  for (const page of PAGES) {
    assert.ok(page.href.startsWith('/'), page.key)
    assert.ok(page.label && page.group, page.key)
  }
})

test('the catalog keeps exact step with the rail itself', () => {
  // A new page in nav.ts must fail this until it is added to PAGES — that is
  // the checklist (docs/PERMISSIONS.md): nav, then the catalog, then the
  // dashboard's TRANSCRIBER_PAGES.
  const leaves = [...SECTIONS.flatMap((section) => section.items), SETTINGS_LEAF]
  assert.equal(leaves.length, PAGES.length)
  const catalogHrefs = new Set(PAGES.map((page) => page.href))
  for (const leaf of leaves) assert.ok(catalogHrefs.has(leaf.href), `nav ${leaf.href} missing from PAGES`)
  const navHrefs = new Set(leaves.map((leaf) => leaf.href))
  for (const page of PAGES) assert.ok(navHrefs.has(page.href), `PAGES ${page.href} is not a rail page`)
})

test('ceo and admin get everything, never from the table', () => {
  for (const role of ['ceo', 'admin']) {
    const map = resolvePermissions({}, role)
    assert.ok(PAGES.every((page) => map[page.key] === 'edit'), role)
    assert.equal(hasAppAccess({}, role), true)
  }
  // A member with nothing gets nothing.
  assert.equal(hasAppAccess({}, 'member'), false)
  assert.ok(PAGES.every((page) => resolvePermissions({}, 'member')[page.key] === 'none'))
})

test('the master broadcasts — except the restricted sections, which stay closed', () => {
  const reader = resolvePermissions({ transcriber: 'read' }, 'member')
  for (const page of PAGES) {
    if (RESTRICTED_PAGE_KEY_SET.has(page.key)) assert.equal(reader[page.key], 'none', page.key)
    else assert.equal(reader[page.key], 'read', page.key)
  }
  const editor = resolvePermissions({ transcriber: 'edit' }, 'member')
  for (const page of PAGES) {
    assert.equal(editor[page.key], RESTRICTED_PAGE_KEY_SET.has(page.key) ? 'none' : 'edit', page.key)
  }
})

test('Scheduler and Client open by name, never by the master', () => {
  const map = resolvePermissions(
    { transcriber: 'edit', 'transcriber.scheduler_calendar': 'read', 'transcriber.inbox': 'edit' },
    'member',
  )
  assert.equal(map.scheduler_calendar, 'read')
  assert.equal(map.inbox, 'edit')
  for (const key of ['scheduler_overview', 'scheduler_new', 'scheduler_accounts', 'app_accounts']) {
    assert.equal(map[key], 'none', key)
  }
  assert.equal(map.overview, 'edit')
  // A restricted grant alone is still a real member.
  const inboxOnly = { transcriber: 'none', 'transcriber.inbox': 'read' }
  assert.equal(hasAppAccess(inboxOnly, 'member'), true)
  assert.deepEqual(
    PAGES.filter((page) => canView(resolvePermissions(inboxOnly, 'member'), page.key)).map((page) => page.key),
    ['inbox'],
  )
})

test('per-page overrides win over the door, in both directions', () => {
  const map = resolvePermissions(
    { transcriber: 'read', 'transcriber.models': 'edit', 'transcriber.library': 'none' },
    'member',
  )
  assert.equal(map.models, 'edit')
  assert.equal(map.library, 'none')
  assert.equal(map.overview, 'read')
})

test('door off + one grant is a real member: exactly that page', () => {
  const raw = { transcriber: 'none', 'transcriber.models': 'edit' }
  assert.equal(hasAppAccess(raw, 'member'), true)
  const map = resolvePermissions(raw, 'member')
  const open = PAGES.filter((page) => canView(map, page.key)).map((page) => page.key)
  assert.deepEqual(open, ['models'])
  assert.equal(canEdit(map, 'models'), true)
  assert.equal(firstAllowedPath(map), '/models')
})

test('garbage in the table never grants anything', () => {
  const raw = { transcriber: 'yes please', 'transcriber.models': 7, 'transcriber.evil_page': 'edit' }
  assert.equal(hasAppAccess(raw, 'member'), false)
  const map = resolvePermissions(raw, 'member')
  assert.ok(PAGES.every((page) => map[page.key] === 'none'))
  const cleaned = sanitizePermissions({ models: 'edit', 'evil key': 'edit', library: 'sometimes' })
  assert.equal(cleaned.models, 'edit')
  assert.equal(cleaned.library, 'none')
  assert.ok(!('evil key' in cleaned))
})

test('a path finds its page by longest href', () => {
  assert.equal(pageForPath('/'), 'overview')
  assert.equal(pageForPath('/models'), 'models')
  assert.equal(pageForPath('/models/some-model'), 'models')
  assert.equal(pageForPath('/video-batcher/effects'), 'studio_effects')
  assert.equal(pageForPath('/video-batcher/effects?x=1'), 'studio_effects')
  assert.equal(pageForPath('/scheduler'), 'scheduler_calendar')
  assert.equal(pageForPath('/scheduler/overview'), 'scheduler_overview')
  assert.equal(pageForPath('/app-content/faq/'), 'content_faq')
  assert.equal(pageForPath('/reddit-trends/subreddits/onlyfans'), 'reddit_trends')
  assert.equal(pageForPath('/settings'), 'settings')
  assert.equal(pageForPath('/nowhere'), null)
})

test('the page gate reads the page that owns the path', () => {
  const map = resolvePermissions({ transcriber: 'none', 'transcriber.sounds': 'read' }, 'member')
  assert.equal(decidePath('/sounds', map).ok, true)
  assert.equal(decidePath('/models', map).ok, false)
  assert.equal(decidePath('/nowhere', map).ok, true) // unowned paths fall through to the APIs' own checks
})

test('reads need View, writes need Edit', () => {
  const readOnlyModels = resolvePermissions({ transcriber: 'read' }, 'member')
  assert.equal(decideApi('/api/models', 'GET', readOnlyModels).ok, true)
  assert.deepEqual(decideApi('/api/models', 'POST', readOnlyModels), { ok: false, page: 'models', need: 'edit' })
  const editor = resolvePermissions({ transcriber: 'edit' }, 'member')
  assert.equal(decideApi('/api/models', 'POST', editor).ok, true)
  assert.equal(decideApi('/api/models/abc/files', 'DELETE', editor).ok, true)
})

test('a page-scoped member cannot reach other pages\' APIs', () => {
  const map = resolvePermissions({ transcriber: 'none', 'transcriber.models': 'edit' }, 'member')
  assert.equal(decideApi('/api/models', 'GET', map).ok, true)
  assert.equal(decideApi('/api/models/abc/posts', 'POST', map).ok, true)
  assert.equal(decideApi('/api/library', 'GET', map).ok, false)
  assert.equal(decideApi('/api/sounds', 'GET', map).ok, false)
})

test('shared helpers pass for any editor, refuse a pure viewer', () => {
  const viewer = resolvePermissions({ transcriber: 'read' }, 'member')
  const libraryEditor = resolvePermissions({ transcriber: 'read', 'transcriber.library': 'edit' }, 'member')
  assert.equal(decideApi('/api/links', 'POST', viewer).ok, false)
  assert.equal(decideApi('/api/links', 'POST', libraryEditor).ok, true)
  assert.equal(decideApi('/api/uploads', 'POST', libraryEditor).ok, true)
  assert.equal(decideApi('/api/nav-assistant', 'GET', viewer).ok, true)
})

test('scheduler routes keep their sub-pages apart', () => {
  const map = resolvePermissions({ transcriber: 'none', 'transcriber.scheduler_accounts': 'edit' }, 'member')
  assert.equal(decideApi('/api/scheduler/accounts', 'POST', map).ok, true)
  assert.equal(decideApi('/api/scheduler/posts/12', 'POST', map).ok, false)
  const calendarEditor = resolvePermissions({ transcriber: 'none', 'transcriber.scheduler_calendar': 'edit' }, 'member')
  assert.equal(decideApi('/api/scheduler/posts/12', 'PATCH', calendarEditor).ok, true)
  assert.equal(decideApi('/api/scheduler/accounts', 'GET', calendarEditor).ok, false)
})

test('an unknown API path still demands at least one page', () => {
  const nothing = resolvePermissions({}, 'member')
  assert.equal(decideApi('/api/whatever', 'GET', nothing).ok, false)
  const someone = resolvePermissions({ transcriber: 'none', 'transcriber.today': 'read' }, 'member')
  assert.equal(decideApi('/api/whatever', 'GET', someone).ok, true)
  assert.equal(decideApi('/api/whatever', 'POST', someone).ok, false)
})

test('first allowed follows the rail order', () => {
  const map = resolvePermissions({ transcriber: 'none', 'transcriber.library': 'read', 'transcriber.trends': 'edit' }, 'member')
  assert.equal(firstAllowedPath(map), '/library')
  assert.equal(firstAllowedPath(resolvePermissions({ transcriber: 'none', 'transcriber.settings': 'read' }, 'member')), '/settings')
  assert.equal(firstAllowedPath(edit([])), null)
  assert.equal(anyEdit(edit([])), false)
  assert.equal(anyEdit(edit(['models'])), true)
})
