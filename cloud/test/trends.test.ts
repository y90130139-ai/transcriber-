// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/trends.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTrendsRss, type TrendsBoard } from '../src/lib/trends-feed'
import { groundingText } from '../src/lib/trends-ask'

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
  <channel>
    <title>Daily Search Trends</title>
    <item>
      <title>hbo max paramount plus merger</title>
      <ht:approx_traffic>200+</ht:approx_traffic>
      <pubDate>Tue, 6 Oct 2026 13:10:00 -0700</pubDate>
      <ht:picture>https://example.com/pic.png</ht:picture>
      <ht:news_item>
        <ht:news_item_title>Paramount&#8217;s Streaming Chief Leaves</ht:news_item_title>
        <ht:news_item_url>https://example.com/a</ht:news_item_url>
      </ht:news_item>
      <ht:news_item>
        <ht:news_item_title>Second story &amp; its title</ht:news_item_title>
        <ht:news_item_url>https://example.com/b</ht:news_item_url>
      </ht:news_item>
    </item>
    <item>
      <title>nicole kidman</title>
      <description/>
    </item>
  </channel>
</rss>`

test('parses terms, traffic, pictures and news from the live feed shape', () => {
  const parsed = parseTrendsRss(FEED)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].term, 'hbo max paramount plus merger')
  assert.equal(parsed[0].traffic, '200+')
  assert.equal(parsed[0].picture, 'https://example.com/pic.png')
  assert.equal(parsed[0].news.length, 2)
  assert.equal(parsed[0].news[0].url, 'https://example.com/a')
})

test('decodes numeric and named entities in titles', () => {
  const parsed = parseTrendsRss(FEED)
  assert.equal(parsed[0].news[0].title, 'Paramount’s Streaming Chief Leaves')
  assert.equal(parsed[0].news[1].title, 'Second story & its title')
})

test('a term with no extras still parses, empty where the feed was', () => {
  const parsed = parseTrendsRss(FEED)
  assert.deepEqual(parsed[1], { term: 'nicole kidman', traffic: null, picture: null, news: [] })
})

test('garbage in, empty list out — never a throw', () => {
  assert.deepEqual(parseTrendsRss('not xml at all'), [])
  assert.deepEqual(parseTrendsRss('<item><title></title></item>'), [])
})

test('grounding text carries every list and flags what is missing', () => {
  const board: TrendsBoard = {
    captured_on: '2026-10-06',
    terms: [{ term: 'golf swing', rank: 1, traffic: '500+', picture: null, rising: true, news: [{ title: 'A story', url: 'https://x' }] }],
    breakouts: [{ post_id: 'p1', handle: 'someone', url: null, caption: 'golf but worse', audio_title: 'Vibin', plays: 120000, multiple: 3.2, posted_at: null }],
    sounds: [],
  }
  const text = groundingText(board)
  assert.match(text, /golf swing.*~500\+ searches.*NEW this week/)
  assert.match(text, /@someone at 3\.2x usual \(120,000 plays\)/)
  assert.match(text, /sound: Vibin/)
  assert.match(text, /SOUNDS SPREADING[\s\S]*\(none in the window\)/)
})
