// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/card-find.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardForKey, findCards, parseCardQuery, snippetAround, type FindableCard } from '../src/lib/card-find'

const card = (over: Partial<FindableCard> = {}): FindableCard => ({
  item_id: over.item_id ?? 'i1',
  plan_id: over.plan_id ?? 'p1',
  week_of: over.week_of ?? '2026-10-05',
  card_no: over.card_no ?? 1,
  item_title: null,
  author: null,
  reel_title: null,
  hook: null,
  caption: null,
  notes: null,
  location: null,
  wardrobe: null,
  preview: null,
  model_note: null,
  model_note_at: null,
  decline_reason: null,
  verdict: 'open',
  filmed: false,
  unread: false,
  has_thumb: false,
  job_id: null,
  webpage_url: null,
  ...over,
})

test('parseCardQuery reads every way a card number gets typed', () => {
  for (const raw of ['V-87', 'v87', 'V 87', '#87', '87', 'v-87 ']) {
    assert.equal(parseCardQuery(raw).cardNo, 87, `failed on ${raw}`)
  }
})

test('parseCardQuery keeps words and drops the noise', () => {
  const parsed = parseCardQuery('  gym   MIRROR ')
  assert.equal(parsed.cardNo, null)
  assert.deepEqual(parsed.words, ['gym', 'mirror'])
})

test('a number she quoted finds that card and nothing else', () => {
  const cards = [card({ item_id: 'a', card_no: 87 }), card({ item_id: 'b', card_no: 8 }), card({ item_id: 'c', card_no: 870 })]
  assert.deepEqual(findCards(cards, 'V-87').map((c) => c.item_id), ['a'])
})

test('a card number still wins when the same digits sit in someone else’s text', () => {
  // "87" in a caption must never outrank the card actually called V-87.
  const cards = [
    card({ item_id: 'text', card_no: 3, caption: 'down 87 pounds' }),
    card({ item_id: 'number', card_no: 87 }),
  ]
  assert.equal(findCards(cards, '87')[0].item_id, 'number')
})

test('words match across the card, the reel and her own words', () => {
  const cards = [
    card({ item_id: 'title', item_title: 'Gym mirror walk' }),
    card({ item_id: 'author', author: 'gymrat.jess' }),
    card({ item_id: 'note', model_note: 'no gym access this week' }),
    card({ item_id: 'miss', caption: 'kitchen counter' }),
  ]
  const ids = findCards(cards, 'gym').map((c) => c.item_id)
  assert.ok(ids.includes('title') && ids.includes('author') && ids.includes('note'))
  assert.ok(!ids.includes('miss'))
})

test('every word has to land, so two words narrow instead of widen', () => {
  const cards = [
    card({ item_id: 'both', item_title: 'Gym mirror walk' }),
    card({ item_id: 'one', item_title: 'Gym bag haul' }),
  ]
  assert.deepEqual(findCards(cards, 'gym mirror').map((c) => c.item_id), ['both'])
})

test('the card’s own name outranks a hit buried in the transcript', () => {
  const cards = [
    card({ item_id: 'deep', preview: 'she walks past a mirror and laughs' }),
    card({ item_id: 'named', item_title: 'Mirror walk' }),
  ]
  assert.equal(findCards(cards, 'mirror')[0].item_id, 'named')
})

test('an unread note breaks a tie — that is the card someone is waiting on', () => {
  const cards = [
    card({ item_id: 'read', item_title: 'Mirror walk', week_of: '2026-10-05' }),
    card({ item_id: 'unread', item_title: 'Mirror walk', week_of: '2026-10-05', model_note: 'can I swap this', unread: true }),
  ]
  assert.equal(findCards(cards, 'mirror')[0].item_id, 'unread')
})

test('with no query it is her history, newest week first, unread on top', () => {
  const cards = [
    card({ item_id: 'old', week_of: '2026-09-07', card_no: 2 }),
    card({ item_id: 'new', week_of: '2026-10-05', card_no: 9 }),
    card({ item_id: 'asked', week_of: '2026-08-31', card_no: 1, model_note: 'what is this one', unread: true }),
  ]
  assert.deepEqual(findCards(cards, '').map((c) => c.item_id), ['asked', 'new', 'old'])
})

test('search is diacritic- and case-blind, because she types on a phone', () => {
  const cards = [card({ item_id: 'a', location: 'Café kitchen' })]
  assert.equal(findCards(cards, 'cafe').length, 1)
  assert.equal(findCards(cards, 'CAFÉ').length, 1)
})

test('a quoted V-number that she never had comes back empty, not with everything', () => {
  assert.deepEqual(findCards([card({ card_no: 4 })], 'V-99'), [])
})

test('snippetAround shows the matched part of a long note, not its first line', () => {
  const note = `${'a'.repeat(200)} the gym is closed this week ${'b'.repeat(200)}`
  const shown = snippetAround(note, ['gym'], 60)
  assert.ok(shown.includes('gym'), shown)
  assert.ok(shown.startsWith('…') && shown.endsWith('…'), shown)
  assert.ok(shown.length <= 64, `too long: ${shown.length}`)
})

test('a note that already fits is shown whole, with its whitespace tidied', () => {
  assert.equal(snippetAround('  can I  swap\nthis one ', ['swap'], 90), 'can I swap this one')
})

test('a long note with no hit falls back to its opening', () => {
  const shown = snippetAround('x'.repeat(300), [], 50)
  assert.ok(shown.startsWith('xxx') && shown.endsWith('…'))
  assert.ok(shown.length <= 51)
})

test('a link resolves by item id, and by the label she quoted', () => {
  const cards = [card({ item_id: 'newer', card_no: 12, week_of: '2026-10-05' }),
                 card({ item_id: 'older', card_no: 12, week_of: '2026-09-07' })]
  assert.equal(cardForKey(cards, 'older')?.item_id, 'older')
  // Her cards are handed over newest first, and a number she just quoted means
  // the card she has in front of her, not the one from a month ago.
  assert.equal(cardForKey(cards, 'V-12')?.item_id, 'newer')
  assert.equal(cardForKey(cards, 'V-99'), null)
  assert.equal(cardForKey(cards, 'mirror walk'), null)
})
