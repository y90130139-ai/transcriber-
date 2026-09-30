// node --import ./test/ts-resolve.mjs --test test/socials-linked.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withLinkedOnlyfans, type Social } from '../src/lib/socials'

const ig: Social = { platform: 'instagram', handle: 'sipsofmilk', url: 'https://www.instagram.com/sipsofmilk/' }

test('matched OnlyFans pages are appended after her saved links', () => {
  const out = withLinkedOnlyfans([ig], ['ninadolcixxx', 'ninadolci'])
  assert.deepEqual(out.map((s) => `${s.platform}:${s.handle}`), ['instagram:sipsofmilk', 'onlyfans:ninadolcixxx', 'onlyfans:ninadolci'])
  assert.equal(out[1].url, 'https://onlyfans.com/ninadolcixxx')
})

test('a page she already saved by hand is not repeated, whatever the case', () => {
  const saved: Social = { platform: 'onlyfans', handle: 'ImBlairBanks', url: 'https://onlyfans.com/ImBlairBanks' }
  const out = withLinkedOnlyfans([saved], ['imblairbanks', 'xxbunniiixx'])
  assert.deepEqual(out.map((s) => s.handle), ['ImBlairBanks', 'xxbunniiixx'])
})

test('nothing matched leaves her links untouched', () => {
  const links = [ig]
  assert.equal(withLinkedOnlyfans(links, []), links)
  assert.equal(withLinkedOnlyfans(links, undefined), links)
  assert.equal(withLinkedOnlyfans(links, ['  ']), links)
})
