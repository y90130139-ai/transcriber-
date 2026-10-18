// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/german.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GERMAN_FORMATS, GERMAN_TYPES, findGerman, germanBrief, germanVersionAt, germanVersionRows } from '../src/lib/german'

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

test('the doc versions string becomes one row per version, marker stripped', () => {
  const rows = germanVersionRows('V1 bra · V2 tight low-cut top · V3 bikini top')
  assert.deepEqual(rows.map((row) => row.outfit), ['bra', 'tight low-cut top', 'bikini top'])
  const ranges = germanVersionRows('V1–4 bedroom · V5–7 bathroom, back to camera, over-shoulder top removal')
  assert.equal(ranges.length, 2)
  assert.equal(ranges[0].outfit, 'bedroom')
  assert.match(ranges[1].outfit, /^bathroom/)
})

test('a versions line that names no outfit does not become a wardrobe', () => {
  for (const none of ['Single version', 'Two takes', 'V1 / V2 same as reference']) {
    const rows = germanVersionRows(none)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].outfit, '')
  }
  // A combo line is the doc's own words and stays whole.
  const combos = germanVersionRows('7 combos: shower or bedroom selfie × dishes / shaker')
  assert.deepEqual(combos, [{ outfit: '7 combos: shower or bedroom selfie × dishes / shaker', caption: '' }])
  // "as reference" among real versions reads as a wardrobe line, not a gap.
  const mixed = germanVersionRows('V1 as reference · V2 couch, new outfit · V3 in bed')
  assert.deepEqual(mixed.map((row) => row.outfit), ['Same as the reference', 'couch, new outfit', 'in bed'])
})

test('every german format yields rows the composer can land', () => {
  for (const format of GERMAN_FORMATS) {
    const rows = germanVersionRows(format.versions)
    assert.ok(rows.length >= 1 && rows.length <= 8, `#${format.no}`)
    for (const row of rows) assert.equal(row.caption, '')
  }
})

test('a numbered take resolves through explicit variants and version ranges', () => {
  assert.deepEqual(germanVersionAt('V1 neutral top, bright underwear · V2 white/patterned underwear, neutral top', 2), {
    outfit: 'white/patterned underwear, neutral top', caption: '',
  })
  assert.deepEqual(germanVersionAt('V1–4 bedroom · V5–7 bathroom, back to camera, over-shoulder top removal', 2), {
    outfit: 'bedroom', caption: '',
  })
  assert.deepEqual(germanVersionAt('V1 / V2 same as reference', 2), {
    outfit: 'Same as the reference', caption: '',
  })
  assert.equal(germanVersionAt('Single version', 2), null)
})
