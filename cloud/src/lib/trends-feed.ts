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

export type TrendTerm = {
  term: string
  rank: number
  traffic: string | null
  picture: string | null
  news: TrendNews[]
  /** Never seen in the week before its capture — new heat, not a standing. */
  rising: boolean
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
}

export type TrendSound = {
  title: string
  artist: string | null
  creators: number
  plays: number
  sample_handles: string[]
}

export type TrendsBoard = {
  captured_on: string | null
  terms: TrendTerm[]
  breakouts: Breakout[]
  sounds: TrendSound[]
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
