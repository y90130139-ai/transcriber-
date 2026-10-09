// node --import ./test/ts-resolve.mjs --test test/reddit-registry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  displayName,
  parseSubredditInput,
  REGISTRY,
  REGISTRY_CANDIDATE_COUNT,
  subredditKey,
  uniqueCandidateCount,
  uniqueCandidates,
} from '../src/lib/reddit/registry'

test('the registry holds twenty adult-space candidates', () => {
  assert.equal(REGISTRY.length, 20)
  assert.equal(REGISTRY_CANDIDATE_COUNT, 20)
})

test('two categories, ten candidates each', () => {
  const byCategory = new Map<string, number>()
  for (const candidate of REGISTRY) {
    byCategory.set(candidate.category, (byCategory.get(candidate.category) ?? 0) + 1)
  }
  assert.equal(byCategory.size, 2)
  for (const [category, count] of byCategory) {
    assert.equal(count, 10, `${category} has ${count}`)
  }
})

test('case-insensitive duplicates collapse to 18 unique communities', () => {
  assert.equal(uniqueCandidateCount(), 18)
  const keys = uniqueCandidates().map((candidate) => subredditKey(candidate.name))
  assert.equal(new Set(keys).size, keys.length)
  // The two known duplicate pairs are the reason 20 becomes 18.
  assert.ok(keys.includes('onlyfansadvice'))
  assert.ok(keys.includes('onlyfanspromotions'))
  assert.equal(keys.filter((key) => key === 'onlyfansadvice').length, 1)
  assert.equal(keys.filter((key) => key === 'onlyfanspromotions').length, 1)
})

test('every registry category is adult-facing and flagged', () => {
  const adultCategories = new Set([
    'OnlyFans and Adult Creator Business',
    'Adult Creator Discovery and Promotion',
  ])
  for (const candidate of REGISTRY) {
    assert.ok(adultCategories.has(candidate.category), candidate.name)
    assert.equal(candidate.adult, true, candidate.name)
  }
  assert.equal(REGISTRY.filter((candidate) => candidate.adult).length, 20)
})

test('parseSubredditInput accepts names, r/ prefixes and URLs', () => {
  assert.deepEqual(parseSubredditInput('SaaS'), { key: 'saas', display: 'SaaS' })
  assert.deepEqual(parseSubredditInput('r/Creators'), { key: 'creators', display: 'Creators' })
  assert.deepEqual(parseSubredditInput('/r/onlyfansadvice'), { key: 'onlyfansadvice', display: 'onlyfansadvice' })
  assert.deepEqual(
    parseSubredditInput('https://www.reddit.com/r/NewTubers/comments/abc123/some_title/?utm_source=x'),
    { key: 'newtubers', display: 'NewTubers' },
  )
  assert.deepEqual(
    parseSubredditInput('reddit.com/r/Twitch_Startup'),
    { key: 'twitch_startup', display: 'Twitch_Startup' },
  )
})

test('parseSubredditInput rejects things that are not communities', () => {
  assert.equal(parseSubredditInput(''), null)
  assert.equal(parseSubredditInput('   '), null)
  assert.equal(parseSubredditInput('a'), null)
  assert.equal(parseSubredditInput('this name has spaces and is long'), null)
  assert.equal(parseSubredditInput('https://example.com/about'), null)
})

test('keys and display names normalise symmetrically', () => {
  assert.equal(subredditKey('r/SaaS/'), 'saas')
  assert.equal(subredditKey('  Creators  '), 'creators')
  assert.equal(displayName('saas'), 'r/saas')
  assert.equal(displayName('r/NewTubers'), 'r/NewTubers')
})
