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
  assert.deepEqual(draftProblems('Ivy is a lovely word', 'Snow', ['Ivy Fox']), [], 'first names under 4 letters only match in full')
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
