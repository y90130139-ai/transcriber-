// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/trends.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanRange,
  directionOf,
  foldTermDays,
  parseTrendsRss,
  sparkPoints,
  windowDays,
  type TermDayRow,
  type TrendsBoard,
} from '../src/lib/trends-feed'
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

test('grounding text carries every list, the window, and flags what is missing', () => {
  const board: TrendsBoard = {
    captured_on: '2026-10-06',
    days: 3,
    terms: [{
      term: 'golf swing', rank: 1, traffic: '500+', picture: null, rising: true,
      news: [{ title: 'A story', url: 'https://x' }],
      days_seen: 2, direction: 'up', spark: [0, 20, 25],
    }],
    breakouts: [{
      post_id: 'p1', handle: 'someone', url: null, caption: 'golf but worse',
      audio_title: 'Vibin', plays: 120000, multiple: 3.2, posted_at: null, thumb_job: null,
    }],
    sounds: [],
  }
  const text = groundingText(board)
  assert.match(text, /Window: the past 3 days/)
  assert.match(text, /golf swing.*~500\+ searches.*NEW this week.*charted 2 of 3 days, trend up/)
  assert.match(text, /@someone at 3\.2x usual \(120,000 plays\)/)
  assert.match(text, /sound: Vibin/)
  assert.match(text, /SOUNDS SPREADING[\s\S]*\(none in the window\)/)
})

test('cleanRange only admits the offered windows', () => {
  assert.equal(cleanRange('3'), 3)
  assert.equal(cleanRange(7), 7)
  assert.equal(cleanRange('5'), 1)
  assert.equal(cleanRange(null), 1)
})

test('directionOf reads a daily series the way a human would', () => {
  assert.equal(directionOf([2, 2, 5]), 'up')
  assert.equal(directionOf([5, 5, 2]), 'down')
  assert.equal(directionOf([3, 3, 3]), 'steady')
  assert.equal(directionOf([0, 0, 4]), 'new')
  assert.equal(directionOf([4]), 'steady') // one day has no direction yet
})

test('sparkPoints spans the box and survives a flat or single point', () => {
  const two = sparkPoints([1, 2], 72, 20)
  assert.match(two, /^1\.0,10\.0 71\.0,1\.0$/)
  assert.equal(sparkPoints([], 72, 20), '')
  // All-zero series draws the midline rather than dividing by zero.
  assert.match(sparkPoints([0, 0], 72, 20), /10\.0/)
})

test('foldTermDays folds a window into ranks, days seen and direction', () => {
  const today = new Date('2026-10-06T12:00:00Z')
  const days = windowDays(3, today)
  assert.deepEqual(days, ['2026-10-04', '2026-10-05', '2026-10-06'])
  const rows: TermDayRow[] = [
    { term: 'a', day: '2026-10-05', rank: 10, traffic: '200+', picture: null, news: [], first_ever: '2026-10-05' },
    { term: 'a', day: '2026-10-06', rank: 2, traffic: '500+', picture: null, news: [], first_ever: '2026-10-05' },
    { term: 'b', day: '2026-10-04', rank: 1, traffic: '1000+', picture: null, news: [], first_ever: '2026-09-20' },
  ]
  const folded = foldTermDays(rows, 3, today)
  // b holds the window's best rank, so it leads even though it faded.
  assert.deepEqual(folded.map((t) => t.term), ['b', 'a'])
  const a = folded[1]
  assert.equal(a.rank, 2)
  assert.equal(a.days_seen, 2)
  assert.equal(a.rising, true) // first ever seen inside the window
  assert.equal(a.direction, 'up') // charted higher on the latest day
  assert.deepEqual(a.spark, [0, 16, 24])
  const b = folded[0]
  assert.equal(b.rising, false) // known since September
  assert.equal(b.direction, 'down') // fell out of the chart
  assert.equal(b.traffic, '1000+') // its newest stored day carries the figure
})
