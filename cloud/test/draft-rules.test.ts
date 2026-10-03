import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftProblems, MAX_DRAFT } from '../src/lib/assistant/draft-rules'

const others = ['Blair Banks', 'Nina Dolci', 'Rey Rey Marie', 'Ivy Fox', 'Sophia Savage']

test('an ordinary reminder passes', () => {
  assert.deepEqual(draftProblems("Hi Magnus! Quick reminder to film today's 3 cards from your plan 🎬", 'Magnus', others), [])
  assert.deepEqual(draftProblems('Your plan: https://transcriber-ten-zeta.vercel.app/p/abc', 'Magnus', others), [])
})

test('never says we edit her videos', () => {
  assert.equal(draftProblems('Send the clips and we will edit them', 'Snow', others).length, 1)
  assert.equal(draftProblems("Send them over, we'll edit tonight", 'Snow', others).length, 1)
  assert.equal(draftProblems('Our editor will cut it', 'Snow', others).length, 1)
  assert.deepEqual(draftProblems('Edit it however you like', 'Snow', others), [])
})

test('never mentions priority, tier, money or rankings', () => {
  assert.match(draftProblems('You are a top priority this week', 'Snow', others)[0], /priority/)
  assert.match(draftProblems('Your tier went up', 'Snow', others)[0], /tier/)
  assert.match(draftProblems('You made $1,200 last week', 'Snow', others)[0], /money/)
  assert.match(draftProblems('You made 1200 dollars', 'Snow', others)[0], /money/)
  assert.match(draftProblems('You ranked first!', 'Snow', others)[0], /other creators/)
  assert.match(draftProblems('Better than the other girls', 'Snow', others)[0], /other creators/)
})

test('never names another creator, full or first name', () => {
  assert.match(draftProblems('Do the same trend Blair did', 'Snow', others)[0], /Blair/)
  assert.match(draftProblems('Like nina dolci posted', 'Snow', others)[0], /nina dolci/i)
  assert.match(draftProblems('Ivy did this one', 'Snow', ['Ivy Fox'])[0], /Ivy/, 'three-letter first names count')
  assert.deepEqual(draftProblems('Jo is fine', 'Snow', ['Jo Smith']), [], 'two-letter first names only match in full')
  assert.deepEqual(draftProblems('Hi Rey Rey!', 'Rey Rey Marie', ['Rey Rey Marie'].filter((n) => n !== 'Rey Rey Marie')), [])
})

test('links only to Instagram, TikTok or her plan', () => {
  assert.deepEqual(draftProblems('Watch https://www.instagram.com/reel/abc/', 'Snow', others), [])
  assert.match(draftProblems('Watch https://onlyfans.com/x', 'Snow', others)[0], /links/)
})

test('empty or too long', () => {
  assert.deepEqual(draftProblems('   ', 'Snow', others), ['it is empty'])
  assert.match(draftProblems('a'.repeat(MAX_DRAFT + 1), 'Snow', others)[0], /characters/)
})

test('gaps the review found are closed', () => {
  const one = (t: string, self = 'Snow', o = others, h: string[] = []) => draftProblems(t, self, o, h)
  assert.match(one('Join t.me/somegroup')[0], /links/, 'bare domains are links too')
  assert.match(one('see bit.ly/x')[0], /links/)
  assert.match(one('Copy instagram.com/blairbanks')[0], /links/, 'a profile is not a reel')
  assert.deepEqual(one('Watch instagram.com/reel/DdxwBuYx-Du/ first'), [])
  assert.deepEqual(one('https://www.tiktok.com/@snow/video/123 ok'), [])
  assert.match(one('You made €50')[0], /money/)
  assert.match(one('Nearly 1.2k this week')[0], /money/)
  assert.match(one('Your earnings are up')[0], /money/)
  assert.match(one("we're editing it tonight")[0], /we edit/)
  assert.match(one('our team edits these')[0], /we edit/)
  assert.deepEqual(one("Let us know once you've edited it"), [], 'asking them about their own edit is fine')
  assert.match(one('Your priorities this week')[0], /priority/)
  assert.match(one('Do what Ria did', 'Snow', ['Ria West'])[0], /Ria/)
  assert.match(one('copy @juno_mae', 'Snow', [], ['juno_mae'])[0], /juno_mae/)
  assert.deepEqual(one('Hi Snow! Film today', 'Snow', ['Snow Other']), [], 'a shared first name is hers')
})
