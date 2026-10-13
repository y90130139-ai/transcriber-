// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/content-styles.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanStyleTargets, cleanVersions, conceptStem, isContentStyle, versionOf, versionTitle } from '../src/lib/styles'
import { FORMAT_REELS, findFormatReel } from '../src/lib/formats'

test('only the four real styles pass the lane check', () => {
  assert.equal(isContentStyle('format'), true)
  assert.equal(isContentStyle('talking'), true)
  assert.equal(isContentStyle('omegle'), true)
  assert.equal(isContentStyle('posts'), true)
  assert.equal(isContentStyle('stories'), false)
  assert.equal(isContentStyle(null), false)
})

test('targets keep known styles, clamp counts, and drop everything else', () => {
  const clean = cleanStyleTargets({ format: 12, talking: 14.4, omegle: -3, posts: 'seven', junk: 9 })
  assert.deepEqual(clean, { format: 12, talking: 14, omegle: 0 })
})

test('a non-object payload is null, not an empty rule', () => {
  assert.equal(cleanStyleTargets(null), null)
  assert.equal(cleanStyleTargets('12'), null)
  assert.equal(cleanStyleTargets(['format']), null)
})

test('a version suffix is stripped back to its concept stem', () => {
  assert.equal(conceptStem('69 · Black top transition · Version 2'), '69 · Black top transition')
  assert.equal(conceptStem('69 · Black top transition'), '69 · Black top transition')
  assert.equal(conceptStem(null), '')
})

test('the composer and the versions tool write the same title', () => {
  assert.equal(versionTitle('69 · Black top transition', 1), '69 · Black top transition · Version 1')
  assert.equal(conceptStem(versionTitle('72 · Skit', 3)), '72 · Skit')
})

test('the version number reads back off a title, and only off one', () => {
  assert.equal(versionOf('German #14 · Viral Clip Format · Version 2'), 2)
  assert.equal(versionOf('German #14 · Viral Clip Format'), null)
  assert.equal(versionOf('Simple Lingerie (Comical)'), null)
  assert.equal(versionOf(null), null)
})

test('versions clean to fields: strings only, empty rows dropped, capped', () => {
  assert.deepEqual(
    cleanVersions([{ outfit: ' bright bikini top ', caption: '' }, { outfit: '', caption: '“hey”' }]),
    [{ outfit: 'bright bikini top', caption: '' }, { outfit: '', caption: '“hey”' }],
  )
  assert.deepEqual(cleanVersions([{ outfit: '', caption: '' }, null, 'junk']), [])
  assert.equal(cleanVersions('nope'), null)
  assert.equal(cleanVersions(null), null)
  assert.equal(cleanVersions(Array.from({ length: 20 }, (_, i) => ({ outfit: `fit ${i}` })))?.length, 8)
})

test('the playbook answers to a number and to a name', () => {
  assert.equal(findFormatReel('69')?.name, 'Black top transition')
  assert.equal(findFormatReel('black')?.no, '69')
  assert.equal(findFormatReel('BATHROOM')?.no, '71')
  assert.equal(findFormatReel('72 skit')?.no, '72')
  assert.equal(findFormatReel('not a format'), null)
  assert.equal(findFormatReel(''), null)
})

test('a German label never matches our own playbook on a substring', () => {
  // "Cleavage" carries "age" — this titled a card "70 · Age" once.
  assert.equal(findFormatReel('German #17 · Cleavage + Task Movement'), null)
  assert.equal(findFormatReel('German #41 · Mirror Reward'), null)
  assert.equal(findFormatReel('German #66 · I Have a Boyfriend'), null)
})

test('every playbook row carries what the composer prefills', () => {
  for (const reel of FORMAT_REELS) {
    assert.ok(reel.no.length > 0)
    assert.ok(reel.name.length > 0)
    assert.ok(reel.dir.length > 0)
    assert.ok(reel.versions.length >= 1)
    for (const version of reel.versions) assert.ok(version.outfit.length > 0)
  }
})
