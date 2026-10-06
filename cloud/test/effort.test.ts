// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/effort.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effortFor, groupBySetup, setupFor, type EffortInput } from '../src/lib/effort'
import type { Measured, MeasuredShot } from '../src/lib/shotlist'

const shot = (over: Partial<MeasuredShot>): MeasuredShot => ({
  start: 0, end: 5, people: 1, framing: 'mid', camera: 'still', selfie: false, labels: [], ...over,
})

const measured = (shots: MeasuredShot[]): Measured => ({ version: 1, duration: 10, shots })

function card(over: Partial<EffortInput>): EffortInput {
  return {
    shots: null, blocks: [], on_screen_captions: null, duration_sec: 10,
    formats: [], original_audio: null, ...over,
  }
}

test('one propped silent shot is a quick one', () => {
  const effort = effortFor(card({
    shots: measured([shot({ camera: 'still' })]),
    on_screen_captions: [{ t: 0, text: 'POV: you woke up late' }],
  }))
  assert.equal(effort.tier, 'quick')
  assert.match(effort.why, /1 shot/)
  assert.match(effort.why, /prop the phone/)
  assert.match(effort.why, /no lines/)
})

test('a second person on camera is never a quick one', () => {
  const effort = effortFor(card({ shots: measured([shot({ people: 2 })]) }))
  assert.equal(effort.tier, 'big')
  assert.match(effort.why, /needs another person/)
})

test('many cuts across scenes with lines to say reads as a bigger shoot', () => {
  const lines = { start: 0, text: 'word '.repeat(50).trim() }
  const effort = effortFor(card({
    shots: measured([
      shot({ labels: ['kitchen'] }),
      shot({ labels: ['car'], camera: 'handheld' }),
      shot({ labels: ['gym'] }),
      shot({ labels: ['kitchen'] }),
    ]),
    blocks: [lines],
  }))
  assert.equal(effort.tier, 'big')
})

test('words on a borrowed sound are not her lines', () => {
  const lipSync = card({
    shots: measured([shot({ selfie: true })]),
    blocks: [{ start: 0, text: 'the trending audio says all of this not her' }],
    original_audio: false,
  })
  assert.match(effortFor(lipSync).why, /no lines/)
  assert.equal(setupFor(lipSync), 'text')
})

test('unmeasured cards fall back to the format tag', () => {
  assert.equal(effortFor(card({ formats: ['text-overlay'] })).tier, 'quick')
  assert.equal(effortFor(card({ formats: ['skit'] })).tier, 'big')
  assert.equal(effortFor(card({ formats: ['talking-head'] })).tier, 'medium')
})

test('a talking card and a silent card land in different sittings', () => {
  assert.equal(setupFor(card({
    shots: measured([shot({ selfie: true })]),
    blocks: [{ start: 0, text: 'okay so story time' }],
  })), 'talk')
  assert.equal(setupFor(card({ shots: measured([shot({})]) })), 'text')
})

test('one-sitting weeks group to null so the page keeps its old shape', () => {
  const silent = () => card({ shots: measured([shot({})]) })
  assert.equal(groupBySetup([silent(), silent(), silent()]), null)
  assert.equal(groupBySetup([]), null)
})

test('sections come easiest first, cards easiest first, nudge on the first only', () => {
  const quick = card({ shots: measured([shot({})]) })
  const harder = card({
    shots: measured([shot({ labels: ['a'] }), shot({ labels: ['b'] })]),
    on_screen_captions: [{ t: 0, text: 'x' }],
  })
  const talk = card({
    shots: measured([shot({ selfie: true })]),
    blocks: [{ start: 0, text: 'word '.repeat(60).trim() }],
  })
  const sections = groupBySetup([talk, harder, quick])
  assert.ok(sections)
  assert.equal(sections[0].key, 'text')
  assert.ok(sections[0].note, 'the easiest section carries the start-here nudge')
  assert.equal(sections[1].note, null)
  // Inside the text sitting the single-shot card beats the three-scene one.
  assert.equal(sections[0].items[0], quick)
  assert.equal(sections[0].items[1], harder)
})
