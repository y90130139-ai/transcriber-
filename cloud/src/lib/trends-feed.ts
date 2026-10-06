/**
 * The pure half of Trends: the RSS parser and every shape the tab speaks.
 * No imports at all, so the tests and the client component can both take
 * from here without dragging the Neon driver anywhere (see the db trap in
 * docs/NEXT-SESSION.md). The queries live in ./trends.
 */

/** The feed carries ~25; cap hard so a malformed answer cannot flood a row set. */
const MAX_TERMS = 50
/** News links kept per term — the first couple say what the term is about. */
const MAX_NEWS = 3

export type TrendNews = { title: string; url: string }

export type ParsedTrend = {
  term: string
  traffic: string | null
  picture: string | null
  news: TrendNews[]
}

/** The windows the tab offers. "Today" is 1; the rest are the trailing days
 *  Geno asked for (2026-10-06: today / 24h / 48h / 3 days / a week). */
export const TREND_RANGES = [1, 2, 3, 7] as const
export type TrendRange = (typeof TREND_RANGES)[number]

export function cleanRange(raw: unknown): TrendRange {
  const n = Number(raw)
  return (TREND_RANGES as readonly number[]).includes(n) ? (n as TrendRange) : 1
}

/** Which way a series is pointing — the chip beside every spark line. */
export type Direction = 'up' | 'down' | 'steady' | 'new'

export type TrendTerm = {
  term: string
  /** Best (lowest) rank it reached inside the window. */
  rank: number
  traffic: string | null
  picture: string | null
  news: TrendNews[]
  /** Never seen in the week before the window — new heat, not a standing. */
  rising: boolean
  /** How many of the window's days it charted. */
  days_seen: number
  direction: Direction
  /** One point per day in the window, oldest first: 0 = not charted,
   *  otherwise a score where higher = better ranked that day. */
  spark: number[]
}

export type Breakout = {
  post_id: string
  handle: string
  url: string | null
  caption: string | null
  audio_title: string | null
  plays: number
  multiple: number
  posted_at: string | null
  /** A library job holding a stored thumbnail for this exact reel, when the
   *  reel was picked into the library — /api/thumb/<id> serves it. The
   *  sightings poster links die in hours; these do not. */
  thumb_job: string | null
}

export type TrendSound = {
  title: string
  artist: string | null
  creators: number
  plays: number
  sample_handles: string[]
  /** Instagram's id for the audio — /reels/audio/<id>/ is its permanent page. */
  audio_id: string | null
  /** A stored, unexpired audio file exists — the Save button's condition. */
  fresh_audio: boolean
  /** Distinct creators per day across the window, oldest first. */
  spark: number[]
  direction: Direction
}

export type TrendsBoard = {
  captured_on: string | null
  /** The window everything above was counted over, in days. */
  days: TrendRange
  terms: TrendTerm[]
  breakouts: Breakout[]
  sounds: TrendSound[]
}

/* ------------------------------------------------- series math */

/** Which way a daily series points. The last day against the mean of what
 *  came before — a single day (or an empty run) has no direction yet. */
export function directionOf(series: number[]): Direction {
  if (series.length < 2) return 'steady'
  const latest = series[series.length - 1]
  const before = series.slice(0, -1)
  if (before.every((value) => value === 0)) return latest > 0 ? 'new' : 'steady'
  const usual = before.reduce((sum, value) => sum + value, 0) / before.length
  if (latest > usual * 1.1) return 'up'
  if (latest < usual * 0.9) return 'down'
  return 'steady'
}

/** Polyline points for a mini line graph, "x,y x,y …" in a w×h box with a
 *  1px breathing edge. A flat or single-point series draws a midline. */
export function sparkPoints(series: number[], width: number, height: number): string {
  if (series.length === 0) return ''
  const top = Math.max(...series)
  const pad = 1
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const step = series.length > 1 ? innerW / (series.length - 1) : 0
  return series
    .map((value, index) => {
      const x = pad + (series.length > 1 ? index * step : innerW / 2)
      const y = top > 0 ? pad + innerH - (value / top) * innerH : pad + innerH / 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/* ------------------------------------------------- term folding */

/** One stored day of one term, as the window query returns it. */
export type TermDayRow = {
  term: string
  day: string
  rank: number | null
  traffic: string | null
  picture: string | null
  news: unknown
  /** The term's first captured day in the whole table. */
  first_ever: string
}

/** The window's days as ISO dates, oldest first, ending today (UTC date —
 *  the same clock `captured_on` is written with). */
export function windowDays(days: number, today = new Date()): string[] {
  const out: string[] = []
  for (let back = days - 1; back >= 0; back--) {
    const d = new Date(today.getTime() - back * 86_400_000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Fold the window's daily rows into one row per term: best rank, days
 *  charted, a per-day spark (higher = better ranked), and the direction.
 *  Ordered by best rank, then by days seen — the window's strongest first. */
export function foldTermDays(rows: TermDayRow[], days: number, today = new Date()): TrendTerm[] {
  const axis = windowDays(days, today)
  const byTerm = new Map<string, TermDayRow[]>()
  for (const row of rows) {
    const list = byTerm.get(row.term) ?? []
    list.push(row)
    byTerm.set(row.term, list)
  }

  const terms: TrendTerm[] = []
  for (const [term, dayRows] of byTerm) {
    const byDay = new Map(dayRows.map((row) => [row.day, row]))
    // A charted day scores by how high it charted; 25 is the feed's depth.
    const spark = axis.map((day) => {
      const row = byDay.get(day)
      return row?.rank ? Math.max(1, 26 - row.rank) : 0
    })
    const best = dayRows.reduce(
      (low, row) => (row.rank !== null && row.rank < low ? row.rank : low),
      Number.POSITIVE_INFINITY,
    )
    const newest = dayRows.reduce((late, row) => (row.day > late.day ? row : late), dayRows[0])
    terms.push({
      term,
      rank: Number.isFinite(best) ? best : 0,
      traffic: newest.traffic,
      picture: newest.picture,
      news: Array.isArray(newest.news) ? (newest.news as TrendNews[]) : [],
      rising: newest.first_ever >= axis[0],
      days_seen: dayRows.length,
      direction: days === 1 ? 'steady' : directionOf(spark),
      spark,
    })
  }

  return terms.sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.days_seen - a.days_seen)
}

/** The named entities Google's feed actually uses, plus numeric forms. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function tagOf(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  if (!match) return null
  const text = decodeEntities(match[1].trim())
  return text || null
}

/** Pure, so the one fragile part — someone else's XML — is the tested part.
 *  Regex over a DOM on purpose: the feed is flat RSS, Node has no DOMParser,
 *  and an xml dependency for five fields is a supply chain for nothing. */
export function parseTrendsRss(xml: string): ParsedTrend[] {
  const items: ParsedTrend[] = []
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const term = tagOf(block, 'title')
    if (!term) continue
    const news: TrendNews[] = []
    for (const [, newsBlock] of block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)) {
      const title = tagOf(newsBlock, 'ht:news_item_title')
      const url = tagOf(newsBlock, 'ht:news_item_url')
      if (title && url && news.length < MAX_NEWS) news.push({ title, url })
    }
    items.push({
      term,
      traffic: tagOf(block, 'ht:approx_traffic'),
      picture: tagOf(block, 'ht:picture'),
      news,
    })
    if (items.length >= MAX_TERMS) break
  }
  return items
}
