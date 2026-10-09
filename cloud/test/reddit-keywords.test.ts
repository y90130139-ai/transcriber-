// node --import ./test/ts-resolve.mjs --test test/reddit-keywords.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  containsKeyword,
  recurringBigrams,
  SEED_TOPICS,
  slugify,
  tokenize,
  topicsForTitle,
} from '../src/lib/reddit/keywords'

test('the seed lexicon is unique and adult-creator-only', () => {
  const slugs = SEED_TOPICS.map((topic) => topic.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  for (const topic of SEED_TOPICS) {
    assert.ok(topic.name && topic.category && topic.keywords.length > 0, topic.slug)
    assert.equal(topic.category, 'OnlyFans / Adult Creators', topic.slug)
    assert.equal(topic.adult, true, topic.slug)
    assert.equal(topic.creator, true, topic.slug)
    // Keywords are stored lower-case so matching is deterministic.
    for (const keyword of topic.keywords) assert.equal(keyword, keyword.toLowerCase(), `${topic.slug}: ${keyword}`)
  }
  assert.ok(SEED_TOPICS.some((topic) => topic.creator))
  assert.ok(SEED_TOPICS.some((topic) => topic.adult))
})

test('containsKeyword respects word boundaries for words', () => {
  assert.equal(containsKeyword('Best onlyfans promotion tips', 'onlyfans'), true)
  assert.equal(containsKeyword('The office closed today', 'of'), false)   // no match inside a word
  assert.equal(containsKeyword('of course', 'of'), true)                  // but a real word still matches
  assert.equal(containsKeyword("capcut's new update", 'capcut'), true)
})

test('containsKeyword matches phrases with a space', () => {
  assert.equal(containsKeyword('my day in the life video', 'day in the life'), true)
  assert.equal(containsKeyword('getready with me', 'get ready with me'), false)
  assert.equal(containsKeyword('A Day in the Life', 'day in the life'), true)
})

test('topicsForTitle credits every topic the title genuinely belongs to', () => {
  const hits = topicsForTitle('OnlyFans promotion tactics for subscriber growth')
  const ids = hits.map((hit) => hit.topic_id)
  assert.ok(ids.includes('onlyfans-promo'))
  assert.ok(ids.includes('onlyfans-growth'))
  for (const hit of hits) assert.ok(hit.weight > 0 && hit.matched)
})

test('phrase matches weigh more than single keywords', () => {
  const hit = topicsForTitle('OnlyFans like for like promotion').find((entry) => entry.topic_id === 'onlyfans-promo')
  assert.ok(hit)
  assert.equal(hit.matched, 'like for like')
  assert.equal(hit.weight, 1.6)
})

test('a title with no lexicon matches returns nothing', () => {
  assert.deepEqual(topicsForTitle('a quiet walk by the river yesterday'), [])
  assert.deepEqual(topicsForTitle('How I grew my TikTok and Instagram with one content calendar'), [])
})

test('tokenize strips urls, stopwords, numbers and noise', () => {
  const tokens = tokenize('Check https://t.co/abc123 the BEST onlyfans strategies 2026!!! for creators')
  assert.ok(tokens.includes('onlyfans'))
  assert.ok(tokens.includes('strategies'))
  assert.ok(tokens.includes('creators'))
  assert.ok(!tokens.includes('the'))
  assert.ok(!tokens.includes('2026'))
  assert.ok(!tokens.some((token) => token.includes('http')))
})

test('recurringBigrams finds phrases that repeat and drops one-offs', () => {
  const titles = [
    'onlyfans promotion strategies that work',
    'onlyfans promotion strategies 2026',
    'best onlyfans promotion strategies for beginners',
    'onlyfans promotion strategies and pricing',
    'unrelated title about fishing',
  ]
  const bigrams = recurringBigrams(titles, 4)
  const phrases = bigrams.map((entry) => entry.phrase)
  assert.ok(phrases.includes('onlyfans promotion'))
  assert.ok(phrases.includes('promotion strategies'))
  assert.ok(!phrases.includes('about fishing'))
})

test('recurringBigrams counts each title once per phrase', () => {
  const titles = ['spam spam spam', 'spam spam', 'spam spam', 'spam spam', 'spam spam']
  const bigrams = recurringBigrams(titles, 2)
  const spam = bigrams.find((entry) => entry.phrase === 'spam spam')
  assert.equal(spam?.count, 5) // five titles, even though the first holds the bigram twice
})

test('slugify is stable and filesystem-safe', () => {
  assert.equal(slugify('AI Video Tools'), 'ai-video-tools')
  assert.equal(slugify('OnlyFans / Adult Creators'), 'onlyfans-adult-creators')
  assert.equal(slugify('  weird &&& name  '), 'weird-and-name')
})
