// node --import ./test/ts-resolve.mjs --test test/reddit-gateway.test.ts
//
// The centralized-gateway guarantee, enforced by inspection: Reddit API
// endpoints may only appear in the one client module, and the client may
// only be constructed by the collector. If someone adds a direct fetch
// elsewhere, this test fails before it can ship.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(path)
  }
  return out
}

const files = walk(SRC).map((path) => ({
  path,
  rel: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))

test('Reddit API endpoints exist only in the centralized client', () => {
  const offenders = files
    .filter((file) => file.rel !== 'lib/reddit/client.ts')
    .filter((file) => /oauth\.reddit\.com|www\.reddit\.com\/api\/v1/.test(file.text))
    .map((file) => file.rel)
  assert.deepEqual(offenders, [], `direct Reddit endpoints found in: ${offenders.join(', ')}`)
})

test('the API client is constructed only by the collector', () => {
  const offenders = files
    .filter((file) => file.rel !== 'lib/reddit/client.ts' && file.rel !== 'lib/reddit/collect.ts')
    .filter((file) => file.text.includes('createRedditClient('))
    .map((file) => file.rel)
  assert.deepEqual(offenders, [], `createRedditClient used in: ${offenders.join(', ')}`)
})

test('no client component touches Reddit API code paths', () => {
  const offenders = files
    .filter((file) => file.text.includes("'use client'"))
    .filter((file) => /lib\/reddit\/(client|collect)/.test(file.text))
    .map((file) => file.rel)
  assert.deepEqual(offenders, [], `client components importing the API layer: ${offenders.join(', ')}`)
})
