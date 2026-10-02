// node --import ./test/ts-resolve.mjs --test test/survey.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSurvey, priorityFor, mergeProfile, nextStep, ON_CAMERA, BATCH } from '../src/lib/survey/core'

const good = {
  lang: 'en',
  per_day: 3,
  days: [1, 3, 5],
  times: ['morning', 'evening'],
  weekly: 9,
  formats: ['talking-head', 'text-overlay'],
  wont: ['gym'],
  personas: ['girl-next-door', 'gfe'],
  busy: 'ahead',
}

test('a complete answer set reads back clean', () => {
  const read = readSurvey(good)
  assert.ok('answers' in read)
  assert.deepEqual(read.answers.days, [1, 3, 5])
  assert.equal(read.answers.weekly, 9)
})

test('bad or missing answers are refused with a reason', () => {
  assert.ok('error' in readSurvey(null))
  assert.ok('error' in readSurvey({ ...good, per_day: 0 }))
  assert.ok('error' in readSurvey({ ...good, days: [] }))
  assert.ok('error' in readSurvey({ ...good, days: [7] }))
  assert.ok('error' in readSurvey({ ...good, times: ['noonish'] }))
  assert.ok('error' in readSurvey({ ...good, weekly: 0 }))
  assert.ok('error' in readSurvey({ ...good, formats: [] }))
  assert.ok('error' in readSurvey({ ...good, formats: ['made-up'] }))
  assert.ok('error' in readSurvey({ ...good, personas: ['a', 'b', 'c', 'd'] }))
  assert.ok('error' in readSurvey({ ...good, busy: 'whatever' }))
})

test('duplicates collapse, a format she will not do cannot also be one she does', () => {
  const read = readSurvey({ ...good, days: [5, 1, 1], wont: ['gym', 'talking-head'] })
  assert.ok('answers' in read)
  assert.deepEqual(read.answers.days, [1, 5])
  assert.deepEqual(read.answers.wont, ['gym'])
})

test('volume sets priority: 21+ S, 14-20 A, 7-13 B, under 7 C', () => {
  const onCam = ['talking-head']
  assert.equal(priorityFor(21, onCam).priority, 'S')
  assert.equal(priorityFor(20, onCam).priority, 'A')
  assert.equal(priorityFor(14, onCam).priority, 'A')
  assert.equal(priorityFor(13, onCam).priority, 'B')
  assert.equal(priorityFor(7, onCam).priority, 'B')
  assert.equal(priorityFor(6, onCam).priority, 'C')
})

test('only quick-to-batch formats costs one step, never below C', () => {
  assert.deepEqual(priorityFor(21, ['text-overlay']), { priority: 'A', base: 'S', steppedDown: true })
  assert.deepEqual(priorityFor(3, ['text-overlay']), { priority: 'C', base: 'C', steppedDown: false })
  assert.equal(priorityFor(21, ['text-overlay', 'skit']).priority, 'S')
})

test('the two format groups do not overlap', () => {
  assert.equal(ON_CAMERA.filter((id) => BATCH.includes(id)).length, 0)
})

test('next step names what would move her up', () => {
  assert.deepEqual(nextStep(9, ['talking-head']), { kind: 'volume', more: 5, to: 'A' })
  assert.deepEqual(nextStep(25, ['text-overlay']), { kind: 'on-camera', to: 'S' })
  assert.deepEqual(nextStep(25, ['skit']), { kind: 'top' })
})

test('her answers win: numbers replaced, tags added, won’t-dos remove formats', () => {
  const read = readSurvey(good)
  assert.ok('answers' in read)
  const { profile, changes } = mergeProfile(
    { weekly_target: 21, filming_days: [], formats: ['gym', 'grwm'], wont_do: ['skit'], persona: ['latina'], priority: null },
    read.answers,
  )
  assert.equal(profile.weekly_target, 9)
  assert.equal(profile.daily_capacity, 3)
  assert.deepEqual(profile.filming_days, [1, 3, 5])
  assert.deepEqual(profile.best_times, ['morning', 'evening'])
  assert.deepEqual(profile.formats, ['grwm', 'talking-head', 'text-overlay'])
  assert.deepEqual(profile.wont_do, ['gym', 'skit'])
  assert.deepEqual(profile.persona, ['gfe', 'girl-next-door', 'latina'])
  assert.equal(profile.priority, 'B')
  assert.ok(changes.some((c) => c.field === 'weekly_target' && c.from === 21 && c.to === 9))
  assert.ok(changes.some((c) => c.field === 'priority' && c.from === null && c.to === 'B'))
})

test('a format she now picks comes off her old won’t-do list', () => {
  const read = readSurvey({ ...good, formats: ['skit'] })
  assert.ok('answers' in read)
  const { profile } = mergeProfile({ weekly_target: 21, filming_days: [], formats: [], wont_do: ['skit'], persona: [], priority: 'A' }, read.answers)
  assert.deepEqual(profile.wont_do, ['gym'])
  assert.deepEqual(profile.formats, ['skit'])
})

test('every format and persona has a Spanish name', async () => {
  const { ES_LABELS } = await import('../src/lib/survey/copy')
  const { taxonomy } = await import('../src/lib/taxonomy')
  const missing = [...taxonomy.format.tags, ...taxonomy.persona.tags].map((t) => t.id).filter((id) => !ES_LABELS[id])
  assert.deepEqual(missing, [])
})

test('every format in a group is a real tag', async () => {
  const { isValidTag } = await import('../src/lib/taxonomy')
  assert.deepEqual([...ON_CAMERA, ...BATCH].filter((id) => !isValidTag('format', id)), [])
})

test('pace bands follow Geno’s four steps: under 7, 7-13, 14-20, 21+', async () => {
  const { paceBand } = await import('../src/lib/survey/core')
  assert.equal(paceBand(6), 'under7')
  assert.equal(paceBand(7), '7to13')
  assert.equal(paceBand(13), '7to13')
  assert.equal(paceBand(14), '14to20')
  assert.equal(paceBand(20), '14to20')
  assert.equal(paceBand(21), '21plus')
})

test('her 70/20/10 split always adds up to her weekly number', async () => {
  const { splitFor } = await import('../src/lib/survey/core')
  assert.deepEqual(splitFor(21), { winners: 15, takes: 4, tests: 2 })
  assert.deepEqual(splitFor(3), { winners: 2, takes: 1, tests: 0 })
  for (const n of [1, 5, 9, 12, 14, 30]) {
    const s = splitFor(n)
    assert.equal(s.winners + s.takes + s.tests, n)
  }
})
