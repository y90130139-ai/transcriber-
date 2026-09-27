// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/shotlist.test.ts
// Measurements are real: Susanna's references, measured by src/shots.py on 2026-09-27.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShotList, cameraLine, type Measured } from '../src/lib/shotlist'

const none = { title: null, original: null }

test('a selfie in the hand says selfie, not back camera (V-24)', () => {
  const measured: Measured = { version: 1, duration: 10.68, shots: [
    { start: 0, end: 10.68, people: 1, framing: 'close', camera: 'handheld', selfie: true, labels: ['health_club'] },
  ] }
  const list = buildShotList({ measured, screen: [{ t: 0, text: 'Your lights are still on.' }], speech: [], sound: none })!
  assert.deepEqual(list.chips, ['📱 Selfie · in your hand', 'One shot', '11 sec'])
  assert.equal(list.steps[0].camera, 'Selfie — front camera, phone in your hand')
  assert.equal(list.steps[0].show, 'Your lights are still on.')
})

test('a propped, still shot says propped (V-25)', () => {
  assert.equal(cameraLine({ people: 1, framing: 'mid', camera: 'still' }), 'Phone propped up, waist up')
  assert.equal(cameraLine({ people: 1, framing: 'full', camera: 'still' }), 'Phone propped up, full length')
})

test('her shot then a clip of something else is two steps, the clip named (V-20)', () => {
  const measured: Measured = { version: 1, duration: 7.83, shots: [
    { start: 0, end: 5.7, people: 1, framing: 'full', camera: 'handheld', labels: ['jeans'] },
    { start: 5.7, end: 7.83, people: 0, framing: 'none', camera: 'still', labels: ['palm_tree', 'tree'] },
  ] }
  const list = buildShotList({ measured, screen: null, speech: [{ start: 1, text: "I know it's gonna" }], sound: none })!
  assert.equal(list.steps.length, 2)
  assert.equal(list.steps[0].you, true)
  assert.equal(list.steps[0].say, "I know it's gonna")
  assert.equal(list.steps[1].you, false)
  assert.match(list.steps[1].camera, /palm tree/)
  assert.equal(list.sound, 'Your own voice — say it your way')
})

test('a trending sound is named', () => {
  const measured: Measured = { version: 1, duration: 8, shots: [
    { start: 0, end: 8, people: 1, framing: 'mid', camera: 'still', labels: [] },
  ] }
  const list = buildShotList({ measured, screen: null, speech: [], sound: { title: 'Careless Whisper', original: false } })!
  assert.match(list.sound, /Careless Whisper/)
})

test('the vision line is used when it exists', () => {
  const measured: Measured = { version: 1, duration: 4, shots: [
    { start: 0, end: 4, people: 0, framing: 'none', camera: 'moving', labels: ['horse'], describe: 'A horse bolts across a field' },
  ] }
  assert.equal(buildShotList({ measured, screen: null, speech: [], sound: none })!.steps[0].what, 'A horse bolts across a field')
})

test('nothing measured, no shot list — the card keeps its old directions', () => {
  assert.equal(buildShotList({ measured: null, screen: null, speech: [], sound: none }), null)
})

test('the vision pass corrects the camera where it is sure', async () => {
  const { settled } = await import('../src/lib/shotlist')
  const base = { start: 0, end: 5, people: 1, framing: 'mid' as const, labels: [] }
  assert.equal(settled({ ...base, camera: 'handheld', camera_seen: 'selfie' }).selfie, true)
  assert.equal(settled({ ...base, camera: 'handheld', camera_seen: 'propped' }).camera, 'still')
  // A frame cannot overrule measured movement: a moving phone is not propped.
  assert.equal(settled({ ...base, camera: 'moving', camera_seen: 'propped' }).camera, 'moving')
})

test('descriptions merge onto their shots, junk dropped', async () => {
  const { mergeDescriptions } = await import('../src/lib/shotlist')
  const measured = { version: 1, duration: 8, shots: [
    { start: 0, end: 4, people: 1, framing: 'close' as const, camera: 'handheld' as const, labels: [] },
    { start: 4, end: 8, people: 0, framing: 'none' as const, camera: 'moving' as const, labels: ['horse'] },
  ] }
  const out = mergeDescriptions(measured, { shots: [
    { no: 1, what: '  She rolls her eyes  ', camera: 'selfie' },
    { no: 2, what: 'A horse runs off', camera: 'banana' },
    { no: 9, what: 'nothing', camera: 'none' },
  ] })
  assert.equal(out.described, true)
  assert.equal(out.shots[0].describe, 'She rolls her eyes')
  assert.equal(out.shots[0].camera_seen, 'selfie')
  assert.equal(out.shots[1].camera_seen, null)
})
