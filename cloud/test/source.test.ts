// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/source.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hiddenFromModel, isSource, sourceLine, sourceOf, SOURCE_TEXT } from '../src/lib/source'

test('a stored tag wins over the bucket', () => {
  assert.equal(sourceOf('original', 'test'), 'original')
  assert.equal(sourceOf('blank', 'reskin'), 'blank')
})

test('garbage in the column falls back to the bucket, never through', () => {
  assert.equal(sourceOf('REFERENCE', 'custom'), 'original')
  assert.equal(sourceOf(42, null), 'reference')
  assert.equal(sourceOf('', 'iteration'), 'reskin')
})

test('the existing library tags itself: custom cards were written by the team', () => {
  assert.equal(sourceOf(null, 'custom'), 'original')
})

test('her winners run again read as a twist, not a copy', () => {
  assert.equal(sourceOf(null, 'reskin'), 'reskin')
  assert.equal(sourceOf(null, 'iteration'), 'reskin')
})

test('a plain library card is a reference, bucket or no bucket', () => {
  assert.equal(sourceOf(null, 'test'), 'reference')
  assert.equal(sourceOf(null, null), 'reference')
  assert.equal(sourceOf(null, 'repurpose'), 'reference')
})

test('drafts and blanks never reach her phone', () => {
  assert.equal(hiddenFromModel('ai_draft'), true)
  assert.equal(hiddenFromModel('blank'), true)
  assert.equal(hiddenFromModel('reference'), false)
  assert.equal(hiddenFromModel('original'), false)
})

test('every source she can see has her wording; the hidden two have none', () => {
  assert.equal(SOURCE_TEXT.reference.chip, 'Copy this one')
  assert.equal(SOURCE_TEXT.reskin.chip, 'Your twist on it')
  assert.equal(SOURCE_TEXT.original.chip, 'Made for you')
  assert.equal(SOURCE_TEXT.ai_draft.chip, null)
  assert.equal(SOURCE_TEXT.blank.chip, null)
})

test('the contents line counts in her words and drops the zeros', () => {
  const items = [
    { source: 'reference' as const }, { source: 'reference' as const },
    { source: 'reskin' as const }, { source: 'original' as const },
  ]
  assert.equal(sourceLine(items), '2 to copy · 1 with a twist · 1 made for you')
  assert.equal(sourceLine([{ source: 'reference' }]), '1 to copy')
  assert.equal(sourceLine([{ source: 'ai_draft' }]), null)
  assert.equal(sourceLine([]), null)
})

test('isSource is a strict gate', () => {
  assert.equal(isSource('reference'), true)
  assert.equal(isSource('Reference'), false)
  assert.equal(isSource(null), false)
})
