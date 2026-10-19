// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/session.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { issueSession, readSession } from '../src/lib/team-auth'

// The secret is read lazily, so it only needs to exist before the calls.
process.env.SESSION_SECRET = 'test-session-secret'

const b64 = (value: string) => Buffer.from(value).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)

/** A token in the format the app minted before the permission map (2026-10-18). */
function legacyToken(payload: Record<string, unknown>): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(payload))
  const signature = createHmac('sha256', process.env.SESSION_SECRET as string)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

const member = (role: 'ceo' | 'admin' | 'member', page_permissions: Record<string, string> = {}) => ({
  id: 'member-1', email: 'iona@example.com', name: 'Iona', role,
  status: 'active', password_hash: 'x', page_permissions,
})

test('an admin session carries every page at edit, even with an empty table', () => {
  const { token, session } = issueSession(member('admin'))
  assert.ok(Object.values(session.permissions).every((level) => level === 'edit'))
  const read = readSession(token)
  assert.ok(read)
  assert.ok(Object.values(read.permissions).every((level) => level === 'edit'))
  assert.equal(read.transcriber, 'edit')
})

test('a legacy admin token (no permission map, transcriber null) still opens everything', () => {
  // The exact shape Iona's browser held before the deploy: old payload, no
  // `perm`, and a null legacy key because she was never granted page by page.
  const token = legacyToken({
    sub: 'member-1', email: 'iona@example.com', name: 'Iona', role: 'admin',
    transcriber: null, iat: now() - 60, exp: now() + 600,
  })
  const session = readSession(token)
  assert.ok(session)
  assert.equal(session.role, 'admin')
  assert.ok(Object.values(session.permissions).every((level) => level === 'edit'))
})

test('legacy member tokens keep their broadcast', () => {
  const read = readSession(legacyToken({
    sub: 'm2', email: 'x@y.test', role: 'member', transcriber: 'read', iat: now(), exp: now() + 600,
  }))
  assert.ok(read)
  assert.equal(read.permissions.models, 'read')
  assert.equal(read.permissions.overview, 'read')

  const edit = readSession(legacyToken({
    sub: 'm3', email: 'x@y.test', role: 'member', transcriber: 'edit', iat: now(), exp: now() + 600,
  }))
  assert.ok(edit)
  assert.equal(edit.permissions.models, 'edit')
})

test('a member with no grants and no map is refused outright', () => {
  const token = legacyToken({
    sub: 'm4', email: 'x@y.test', role: 'member', transcriber: null, iat: now(), exp: now() + 600,
  })
  assert.equal(readSession(token), null)
})

test('tampering or expiry still closes the door', () => {
  const good = issueSession(member('member', { transcriber: 'read' })).token
  assert.equal(readSession(`${good.slice(0, -2)}xx`), null)
  assert.equal(readSession(legacyToken({
    sub: 'm5', email: 'x@y.test', role: 'admin', iat: now() - 999, exp: now() - 1,
  })), null)
})
