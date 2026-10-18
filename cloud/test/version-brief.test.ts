import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versionBriefFor } from '../src/lib/version-brief'

test('a legacy FORMAT #6 (V2) title gets its exact playbook variation and direction', () => {
  assert.deepEqual(versionBriefFor('FORMAT #6 (V2)', null, null), {
    number: 2,
    current: 'white/patterned underwear, neutral top',
    previous: 'neutral top, bright underwear',
    direction: 'Back camera, strong eye contact. Quick flash as the shirt lifts, then step close to camera so the shirt hem stays out of frame. Editor crops if angles miss.',
  })
})

test('saved version details override the playbook and are compared to Version 1', () => {
  const brief = versionBriefFor('FORMAT #6 (V2)', [
    { outfit: 'black top', caption: '' },
    { outfit: 'white top', caption: 'New caption' },
  ], 'Turn to camera on the last beat.')
  assert.deepEqual(brief, {
    number: 2,
    current: 'white top · New caption',
    previous: 'black top',
    direction: 'Turn to camera on the last beat.',
  })
})

test('non-catalog version titles are flagged without inventing a wardrobe', () => {
  assert.deepEqual(versionBriefFor('Talking head #4 (V2)', null, null), {
    number: 2,
    current: null,
    previous: null,
    direction: null,
  })
})

test('ordinary cards do not get version guidance', () => {
  assert.equal(versionBriefFor('FORMAT #6', null, null), null)
})
