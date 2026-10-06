/**
 * Trends — what the world is searching and what the library is proving,
 * side by side (Geno, 2026-10-06: a "Trends AI" box you can ask "what's
 * trending today?" with answers grounded in real data, not vibes).
 *
 * Three sources, all already paid for:
 *   terms      Google's Trending Now RSS feed — free, no key, ~25 searches
 *              the US is doing right now. Pulled once a day by the cloud
 *              cron into `transcriber.trends_terms`, so "rising" can mean
 *              something (a term we have never seen in the last week).
 *   breakouts  the library's own cross-creator winners: watched accounts'
 *              reels from the last 14 days at 2×+ their creator's usual
 *              plays — the same multiple the 70/20/10 rule is written in.
 *   sounds     audio spreading across watched accounts — the same reel
 *              economy Scout already records (`sightings.audio_title`),
 *              counted by how many different creators used it, because one
 *              creator looping her own sound is not a trend.
 *
 * The BigQuery Trends dataset and interest-over-time curves from the parked
 * plan need GCP credentials; this starts with what runs today and the chat
 * answers from whatever is here.
 *
 * This is the database half; the parser and every shared type live in
 * ./trends-feed, which is import-free on purpose.
 */
import { sql } from './db'
import { parseTrendsRss, type Breakout, type TrendNews, type TrendsBoard, type TrendSound } from './trends-feed'

const RSS_URL = 'https://trends.google.com/trending/rss'
/** Google's feed answers plain fetches today; a UA keeps it boring. */
const RSS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'
const GEO = 'US'

/** Breakouts: the window the digest's own winners rule uses, over the recent
 *  slice where "trending" still means anything. */
const BREAKOUT_DAYS = 14
const BREAKOUT_MIN_MULTIPLE = 2
const BREAKOUT_LIMIT = 12
/** A creator needs this many measured posts before her median means much. */
const MEDIAN_MIN_POSTS = 5

const SOUND_DAYS = 14
const SOUND_LIMIT = 12
/** Instagram labels every creator-made audio this; it is a bucket, not a sound. */
const NOT_A_SOUND = new Set(['original audio', 'mix'])

/** Pull today's feed and store it under today's date (the feed is "now"; the
 *  date is ours). Re-running a day updates ranks rather than doubling rows. */
export async function ingestTrends(): Promise<{ stored: number }> {
  const response = await fetch(`${RSS_URL}?geo=${GEO}`, {
    headers: { 'User-Agent': RSS_UA, Accept: 'application/rss+xml, application/xml' },
  })
  if (!response.ok) throw new Error(`trends feed answered ${response.status}`)
  const terms = parseTrendsRss(await response.text())
  if (terms.length === 0) return { stored: 0 }

  await sql.query(
    `insert into transcriber.trends_terms (term, geo, captured_on, rank, traffic, picture, news)
     select x.term, $2, current_date, x.rank, x.traffic, x.picture, x.news
       from jsonb_to_recordset($1::jsonb)
            as x(term text, rank int, traffic text, picture text, news jsonb)
     on conflict (term, geo, captured_on)
     do update set rank = excluded.rank, traffic = excluded.traffic,
                   picture = excluded.picture, news = excluded.news`,
    [JSON.stringify(terms.map((t, index) => ({ ...t, rank: index + 1 }))), GEO],
  )
  return { stored: terms.length }
}

export async function trendsBoard(): Promise<TrendsBoard> {
  const [terms, breakouts, sounds] = await Promise.all([latestTerms(), libraryBreakouts(), spreadingSounds()])
  return {
    captured_on: terms[0]?.captured_on ?? null,
    terms: terms.map((row) => ({
      term: String(row.term),
      rank: Number(row.rank ?? 0),
      traffic: row.traffic ? String(row.traffic) : null,
      picture: row.picture ? String(row.picture) : null,
      news: Array.isArray(row.news) ? (row.news as TrendNews[]) : [],
      rising: Boolean(row.rising),
    })),
    breakouts,
    sounds,
  }
}

type TermRow = {
  term: string
  rank: number | null
  traffic: string | null
  picture: string | null
  news: unknown
  rising: boolean
  captured_on: string
}

async function latestTerms(): Promise<TermRow[]> {
  // The newest day we hold, whole — not "today", so the board still has
  // yesterday's answer at 09:00 before the 10:00 pull lands.
  return (await sql.query(
    `with latest as (select max(captured_on) as day from transcriber.trends_terms where geo = $1)
     select t.term, t.rank, t.traffic, t.picture, t.news, t.captured_on::text,
            not exists (
              select 1 from transcriber.trends_terms p
               where p.term = t.term and p.geo = t.geo
                 and p.captured_on < t.captured_on
                 and p.captured_on > t.captured_on - 8
            ) as rising
       from transcriber.trends_terms t, latest
      where t.geo = $1 and t.captured_on = latest.day
      order by t.rank nulls last, t.term`,
    [GEO],
  )) as TermRow[]
}

async function libraryBreakouts(): Promise<Breakout[]> {
  const rows = await sql.query(
    `with usual as (
       select handle,
              percentile_cont(0.5) within group (order by plays) as median
         from transcriber.sightings
        where plays is not null and posted_at > now() - interval '90 days'
        group by handle
       having count(*) >= ${MEDIAN_MIN_POSTS}
     )
     select s.post_id, s.handle, s.url, s.caption, s.audio_title, s.plays,
            s.posted_at::text as posted_at,
            round((s.plays / nullif(u.median, 0))::numeric, 1) as multiple
       from transcriber.sightings s
       join usual u on u.handle = s.handle and u.median > 0
      where s.posted_at > now() - interval '${BREAKOUT_DAYS} days'
        and s.plays is not null
        and s.plays >= u.median * ${BREAKOUT_MIN_MULTIPLE}
      order by multiple desc, s.plays desc
      limit ${BREAKOUT_LIMIT}`,
  )
  return rows.map((row) => ({
    post_id: String(row.post_id),
    handle: String(row.handle),
    url: row.url ? String(row.url) : null,
    caption: row.caption ? String(row.caption).slice(0, 160) : null,
    audio_title: row.audio_title ? String(row.audio_title) : null,
    plays: Number(row.plays ?? 0),
    multiple: Number(row.multiple ?? 0),
    posted_at: row.posted_at ? String(row.posted_at) : null,
  }))
}

async function spreadingSounds(): Promise<TrendSound[]> {
  const rows = await sql.query(
    `select audio_title, max(audio_artist) as artist,
            count(distinct handle) as creators, coalesce(sum(plays), 0) as plays,
            (array_agg(distinct handle))[1:3] as sample_handles
       from transcriber.sightings
      where posted_at > now() - interval '${SOUND_DAYS} days'
        and audio_title is not null
        and lower(audio_title) not in (${[...NOT_A_SOUND].map((s) => `'${s}'`).join(', ')})
      group by audio_title
     having count(distinct handle) >= 2
      order by creators desc, plays desc
      limit ${SOUND_LIMIT}`,
  )
  return rows.map((row) => ({
    title: String(row.audio_title),
    artist: row.artist ? String(row.artist) : null,
    creators: Number(row.creators ?? 0),
    plays: Number(row.plays ?? 0),
    sample_handles: Array.isArray(row.sample_handles) ? row.sample_handles.map(String) : [],
  }))
}
