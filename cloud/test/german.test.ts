// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/german.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GERMAN_FORMATS, GERMAN_TYPES, findGerman, germanBrief } from '../src/lib/german'

test('six types, 57 formats, matching the source doc', () => {
  assert.equal(GERMAN_TYPES.length, 6)
  assert.equal(GERMAN_FORMATS.length, 57)
  const counts = GERMAN_TYPES.map((type) => type.formats.length)
  assert.deepEqual(counts, [11, 10, 13, 5, 7, 11])
})

test('every number is unique and every entry is filled in', () => {
  const nos = GERMAN_FORMATS.map((format) => format.no)
  assert.equal(new Set(nos).size, nos.length)
  for (const format of GERMAN_FORMATS) {
    assert.ok(format.name.length > 0, `#${format.no} has a name`)
    assert.ok(format.direction.length > 10, `#${format.no} has a direction`)
    assert.ok(format.versions.length > 0, `#${format.no} has versions`)
    assert.ok(format.caption.length > 0, `#${format.no} has a caption line`)
  }
})

test('the conduct cuts hold: #1 and #2 are not in the playbook', () => {
  assert.equal(findGerman('1'), undefined)
  assert.equal(findGerman('2'), undefined)
})

test('#52 and #64 carry only their cleared captions', () => {
  const friendsOver = findGerman('52')
  assert.ok(friendsOver)
  assert.match(friendsOver.caption, /brother/)
  assert.doesNotMatch(friendsOver.caption, /parents|your age/i)

  const comparison = findGerman('64')
  assert.ok(comparison)
  assert.match(comparison.caption, /Skinny guy/)
})

test('the brief reads as directions, versions, caption', () => {
  const spoon = findGerman('45')
  assert.ok(spoon)
  const brief = germanBrief(spoon)
  assert.match(brief, /^Clip 1: kitchen/)
  assert.match(brief, /\nVersions: V1 white tank/)
  assert.match(brief, /\nCaption: /)
  const silent = findGerman('5')
  assert.ok(silent)
  assert.match(germanBrief(silent), /No captions on this one\./)
})

test('the doubled source number survives as 58b', () => {
  assert.ok(findGerman('58'))
  assert.ok(findGerman('58b'))
})
