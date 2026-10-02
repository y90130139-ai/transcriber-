// node --import ./test/ts-resolve.mjs --test test/queue-state.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queueState, waitingLine, stuckReason, VIEW_TRIES } from '../src/lib/queue-state'

const reel = 'https://instagram.com/reel/DdsVfzQtwZ_'
const blocked = `could not download ${reel}\ncommand failed (1): yt-dlp ...\nERROR: empty media response`

test('queued and running stay in flight', () => {
  assert.equal(queueState({ status: 'queued', source: reel, error: null }), 'flight')
  assert.equal(queueState({ status: 'running', source: reel, error: null }), 'flight')
})

test('a reel Instagram would not hand over waits for the viewer', () => {
  assert.equal(queueState({ status: 'failed', source: reel, error: blocked }), 'viewer')
  assert.equal(queueState({ status: 'failed', source: reel, error: blocked, view_tries: VIEW_TRIES - 1 }), 'viewer')
})

test('after the viewer gives up, or for anything it cannot open, it needs a person', () => {
  assert.equal(queueState({ status: 'failed', source: reel, error: blocked, view_tries: VIEW_TRIES }), 'stuck')
  assert.equal(queueState({ status: 'failed', source: 'https://instagram.com/bubbles.xxoo', error: 'could not download https://instagram.com/bubbles.xxoo' }), 'stuck')
  assert.equal(queueState({ status: 'failed', source: reel, error: 'gave up after 3 interrupted attempts' }), 'stuck')
})

test('the waiting line counts the viewer’s tries', () => {
  assert.equal(waitingLine({ view_tries: 0 }), 'Next in line for a signed-in look')
  assert.equal(waitingLine({ view_tries: 1 }), 'Viewer found no video yet · try 1 of 3')
})

test('stuck reasons read as words, not log lines', () => {
  assert.match(stuckReason({ source: 'https://instagram.com/bubbles.xxoo', error: 'could not download https://instagram.com/bubbles.xxoo' }), /profile link/i)
  assert.match(stuckReason({ source: reel, error: 'Instagram returned this post as photo media — caption…' }), /photo/i)
  assert.match(stuckReason({ source: reel, error: 'gave up after 3 interrupted attempts' }), /interrupted/i)
  assert.match(stuckReason({ source: reel, error: blocked, view_tries: 3 }), /deleted or private/i)
  assert.equal(stuckReason({ source: reel, error: 'disk full\nmore detail' }), 'disk full')
  assert.equal(stuckReason({ source: reel, error: null }), 'Failed')
})
