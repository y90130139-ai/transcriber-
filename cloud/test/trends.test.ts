// node --import ./cloud/test/ts-resolve.mjs --test cloud/test/trends.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanGeo,
  cleanInterestRange,
  cleanRange,
  directionOf,
  foldTermDays,
  interestStamp,
  interestTick,
  parseInterestExplore,
  parseInterestQuery,
  parseInterestTimeline,
  parseTrendingNow,
  parseTrendsRss,
  sparkPoints,
  startedLabel,
  volumeLabel,
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
  assert.match(text, /GOOGLE SEARCH TRENDS \(US daily archive/)
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

/* ---- the live Trending Now endpoint (captured shape, 2026-10-06) ---- */

function liveEnvelope(rows: unknown[]): string {
  const inner = JSON.stringify([null, rows])
  const frame = JSON.stringify([['wrb.fr', 'i0OFE', inner, null, 'generic']])
  return `)]}'\n\n${frame}\n25\n[["di",59]]\n`
}

const LIVE_ROWS = [
  ['argentina vs benin', null, 'US', [1791228000], null, null, 500000, null, 1000,
    ['argentina vs benin', 'argentina', 'messi last game'], [17], [[1, 'en', 'US']], 'argentina vs benin'],
  ['gypsy rose', null, 'US', [1790900000], null, null, 2000000, null, 1000,
    ['ken urker', 'gypsy rose husband'], [3], [], 'gypsy rose'],
  ['bare row', null, 'US', null, null, null, null, null, null, null],
]

test('parseTrendingNow reads term, volume, spike, start and breakdown', () => {
  const parsed = parseTrendingNow(liveEnvelope(LIVE_ROWS))
  assert.equal(parsed.length, 3)
  assert.deepEqual(parsed[0], {
    term: 'argentina vs benin',
    volume: 500000,
    pct: 1000,
    started: 1791228000,
    breakdown: ['argentina vs benin', 'argentina', 'messi last game'],
  })
  // A row with every optional field missing still stands, empty where it was.
  assert.deepEqual(parsed[2], { term: 'bare row', volume: null, pct: null, started: null, breakdown: [] })
})

test('parseTrendingNow answers garbage with an empty list, never a throw', () => {
  assert.deepEqual(parseTrendingNow('not a response'), [])
  assert.deepEqual(parseTrendingNow(`)]}'\n[["wrb.fr","i0OFE","broken json"]]`), [])
})

test('volume and started labels write what Google writes', () => {
  assert.equal(volumeLabel(2_000_000), '2M+')
  assert.equal(volumeLabel(500_000), '500K+')
  assert.equal(volumeLabel(200), '200+')
  assert.equal(volumeLabel(null), null)
  const now = 1791228000 * 1000 + 3 * 86_400_000
  assert.equal(startedLabel(1791228000, now), '3 days ago')
  assert.equal(startedLabel(1791228000, 1791228000 * 1000 + 7 * 3_600_000), '7 hours ago')
})

test('cleanGeo admits the country and its states, nothing else', () => {
  assert.equal(cleanGeo('US-TX'), 'US-TX')
  assert.equal(cleanGeo('US'), 'US')
  assert.equal(cleanGeo('FR'), 'US')
  assert.equal(cleanGeo(undefined), 'US')
})

test('grounding prefers the live list and prints its figures', () => {
  const board: TrendsBoard = {
    captured_on: '2026-10-06', days: 7, terms: [], breakouts: [], sounds: [],
    geo: 'US-TX',
    live: [{ term: 'gypsy rose', volume: 2000000, pct: 1000, started: 1791000000, breakdown: ['ken urker'] }],
  }
  const text = groundingText(board)
  assert.match(text, /GOOGLE TRENDING NOW \(US-TX, the past 7 days/)
  assert.match(text, /gypsy rose · 2M\+ searches · \+1,000% · started .* · about: ken urker/)
})

/* ---- interest over time (explore + multiline, captured shape 2026-10-08) ---- */

const EXPLORE = `)]}'
{"widgets":[{"id":"GEO_MAP","token":"other"},{"id":"TIMESERIES","token":"AB6YKJMAAAAAasgTSBy5","request":{"time":"2026-09-30T22:03:38 2026-10-07T22:03:38","resolution":"HOUR","locale":"en-US"}}]}`

const TIMELINE = `)]}'
{"default":{"timelineData":[
  {"time":"1790805600","formattedAxisTime":"Sep 30 at 10:00 PM","value":[0,10],"hasData":[true,true]},
  {"time":"1790812800","formattedAxisTime":"Oct 1 at 12:00 AM","value":[3,22],"hasData":[true,true]},
  {"time":"broken","value":[1,2]},
  {"time":"1790816400","value":["x",2]},
  {"time":"1790818200","value":[7,31]}
]}}`

test('parseInterestExplore finds the TIMESERIES widget behind the guard line', () => {
  const widget = parseInterestExplore(EXPLORE)
  assert.ok(widget)
  assert.equal(widget.token, 'AB6YKJMAAAAAasgTSBy5')
  assert.equal((widget.request as { resolution?: string }).resolution, 'HOUR')
  assert.equal(parseInterestExplore('not a response'), null)
  assert.equal(parseInterestExplore(')]}\'\n{"widgets":[{"id":"GEO_MAP"}]}'), null)
  assert.equal(parseInterestExplore(')]}\'\n{"widgets":[{"id":"TIMESERIES","request":{}}]}'), null)
})

test('parseInterestTimeline keeps finite points and drops broken rows', () => {
  const points = parseInterestTimeline(TIMELINE)
  assert.deepEqual(points, [
    { t: 1790805600, v: [0, 10] },
    { t: 1790812800, v: [3, 22] },
    { t: 1790818200, v: [7, 31] },
  ])
  assert.deepEqual(parseInterestTimeline('garbage'), [])
})

test('parseInterestQuery reads "a vs b" and commas, dedupes, caps at five', () => {
  assert.deepEqual(parseInterestQuery('namibia vs usa'), ['namibia', 'usa'])
  assert.deepEqual(parseInterestQuery('namibia vs. usa'), ['namibia', 'usa'])
  assert.deepEqual(parseInterestQuery('a, b, A'), ['a', 'b'])
  assert.deepEqual(parseInterestQuery('  spaced   term  '), ['spaced term'])
  assert.deepEqual(parseInterestQuery('a|b,c vs d,e vs f vs g'), ['a|b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(parseInterestQuery('   '), [])
})

test('cleanInterestRange admits the graph windows, defaults to 7 days', () => {
  assert.equal(cleanInterestRange('now 1-d'), 'now 1-d')
  assert.equal(cleanInterestRange('today 5-y'), 'today 5-y')
  assert.equal(cleanInterestRange('now 4-H'), 'now 7-d')
  assert.equal(cleanInterestRange(null), 'now 7-d')
})

test('interest stamps and ticks are pinned to UTC', () => {
  assert.equal(interestStamp(0, 'now 1-d'), 'Jan 1, 12:00 AM')
  assert.equal(interestStamp(0, 'now 7-d'), 'Jan 1, 1970')
  assert.equal(interestStamp(0, 'today 12-m'), 'Jan 1970')
  assert.equal(interestStamp(0, 'today 5-y'), '1970')
  assert.equal(interestTick(0, 'now 1-d'), '12 AM')
  assert.equal(interestTick(0, 'today 12-m'), 'Jan')
  assert.equal(interestTick(0, 'now 7-d'), 'Jan 1')
})
