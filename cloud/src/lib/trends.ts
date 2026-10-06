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
import {
  directionOf,
  foldTermDays,
  parseTrendsRss,
  windowDays,
  type Breakout,
  type TermDayRow,
  type TrendRange,
  type TrendsBoard,
  type TrendSound,
} from './trends-feed'

const RSS_URL = 'https://trends.google.com/trending/rss'
/** Google's feed answers plain fetches today; a UA keeps it boring. */
const RSS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'
const GEO = 'US'

/** Breakouts: the same 2× multiple the 70/20/10 rule is written in; the
 *  window is the tab's own range picker. */
const BREAKOUT_MIN_MULTIPLE = 2
const BREAKOUT_LIMIT = 12
/** A creator needs this many measured posts before her median means much. */
const MEDIAN_MIN_POSTS = 5

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

export async function trendsBoard(days: TrendRange = 1): Promise<TrendsBoard> {
  const [termRows, newest, breakouts, sounds] = await Promise.all([
    termDays(days),
    sql.query(`select max(captured_on)::text as day from transcriber.trends_terms where geo = $1`, [GEO]),
    libraryBreakouts(days),
    spreadingSounds(days),
  ])
  const newestDay = newest[0]?.day ? String(newest[0].day) : null
  return {
    captured_on: newestDay,
    days,
    // "Today" folds on the newest stored day's own axis, so a board read
    // before the 10:00 pull still lines its one point up with its data.
    terms: foldTermDays(termRows, days, days === 1 && newestDay ? new Date(`${newestDay}T12:00:00Z`) : undefined),
    breakouts,
    sounds,
  }
}

/** Every stored day inside the window, one row per term per day. "Today" is
 *  special-cased to the newest stored day, so the board is never blank at
 *  09:00 just because the 10:00 pull has not landed yet. */
async function termDays(days: TrendRange): Promise<TermDayRow[]> {
  const rows = await sql.query(
    days === 1
      ? `with latest as (select max(captured_on) as day from transcriber.trends_terms where geo = $1)
         select t.term, t.captured_on::text as day, t.rank, t.traffic, t.picture, t.news,
                f.first_ever
           from transcriber.trends_terms t
           join latest on t.captured_on = latest.day
           join lateral (
             select min(captured_on)::text as first_ever
               from transcriber.trends_terms e where e.term = t.term and e.geo = t.geo
           ) f on true
          where t.geo = $1`
      : `select t.term, t.captured_on::text as day, t.rank, t.traffic, t.picture, t.news,
                f.first_ever
           from transcriber.trends_terms t
           join lateral (
             select min(captured_on)::text as first_ever
               from transcriber.trends_terms e where e.term = t.term and e.geo = t.geo
           ) f on true
          where t.geo = $1 and t.captured_on > current_date - ${days}`,
    [GEO],
  )
  return rows.map((row) => ({
    term: String(row.term),
    day: String(row.day),
    rank: row.rank === null ? null : Number(row.rank),
    traffic: row.traffic ? String(row.traffic) : null,
    picture: row.picture ? String(row.picture) : null,
    news: row.news,
    first_ever: String(row.first_ever),
  }))
}

async function libraryBreakouts(days: TrendRange): Promise<Breakout[]> {
  // Reels land in sightings with Friday's weekly pass, so a 1–3 day window
  // is empty most of the week. The panel floors at 7 and says so; the short
  // windows stay meaningful for the Google terms, which really are daily.
  const window = Math.max(days, 7)
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
            round((s.plays / nullif(u.median, 0))::numeric, 1) as multiple,
            ( -- The reel's stored thumbnail, when the library picked it up.
              -- The sightings poster links die within hours; these keep.
              select t.job_id
                from transcriber.jobs j
                join transcriber.transcripts t on t.job_id = j.id
               where j.source ~ ('/' || s.post_id || '/?([?#].*)?$')
                 and t.thumbnail is not null
               limit 1
            ) as thumb_job
       from transcriber.sightings s
       join usual u on u.handle = s.handle and u.median > 0
      where s.posted_at > now() - interval '${window} days'
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
    thumb_job: row.thumb_job ? String(row.thumb_job) : null,
  }))
}

async function spreadingSounds(days: TrendRange): Promise<TrendSound[]> {
  // Same floor as breakouts: reels arrive weekly, and a sound needs two
  // different creators to count at all.
  const window = Math.max(days, 7)
  const skip = [...NOT_A_SOUND].map((s) => `'${s}'`).join(', ')
  const rows = await sql.query(
    `select audio_title, max(audio_artist) as artist,
            count(distinct handle) as creators, coalesce(sum(plays), 0) as plays,
            (array_agg(distinct handle))[1:3] as sample_handles,
            max(audio_id) as audio_id,
            bool_or(audio_url is not null and media_until > now()) as fresh_audio
       from transcriber.sightings
      where posted_at > now() - interval '${window} days'
        and audio_title is not null
        and lower(audio_title) not in (${skip})
      group by audio_title
     having count(distinct handle) >= 2
      order by creators desc, plays desc
      limit ${SOUND_LIMIT}`,
  )
  if (rows.length === 0) return []

  // One series query for all of them: distinct creators per sound per day.
  // The axis ends at the newest *sighted* post, not today — reels arrive
  // with Friday's pass, and days nobody has swept yet would otherwise read
  // as every sound dying on Wednesday.
  const titles = rows.map((row) => String(row.audio_title))
  const [coverage] = await sql.query(`select max(posted_at)::date::text as through from transcriber.sightings`)
  const through = coverage?.through ? new Date(`${coverage.through}T12:00:00Z`) : new Date()
  const axis = windowDays(window, through)
  const daily = await sql.query(
    `select audio_title, posted_at::date::text as day, count(distinct handle) as creators
       from transcriber.sightings
      where audio_title = any($1) and posted_at > now() - interval '${window} days'
      group by audio_title, posted_at::date`,
    [titles],
  )
  const series = new Map<string, Map<string, number>>()
  for (const row of daily) {
    const byDay = series.get(String(row.audio_title)) ?? new Map<string, number>()
    byDay.set(String(row.day), Number(row.creators))
    series.set(String(row.audio_title), byDay)
  }

  return rows.map((row) => {
    const title = String(row.audio_title)
    const byDay = series.get(title) ?? new Map<string, number>()
    const spark = axis.map((day) => byDay.get(day) ?? 0)
    return {
      title,
      artist: row.artist ? String(row.artist) : null,
      creators: Number(row.creators ?? 0),
      plays: Number(row.plays ?? 0),
      sample_handles: Array.isArray(row.sample_handles) ? row.sample_handles.map(String) : [],
      audio_id: row.audio_id ? String(row.audio_id) : null,
      fresh_audio: Boolean(row.fresh_audio),
      spark,
      direction: directionOf(spark),
    }
  })
}

/** The freshest stored, unexpired audio file for a sound — the Save button's
 *  source. Instagram's media links die in hours; Scout's passes renew them,
 *  so right after a pass most sounds have one and days later few do. */
export async function freshAudioFor(title: string): Promise<{ url: string; post_id: string } | null> {
  const rows = await sql.query(
    `select audio_url, post_id
       from transcriber.sightings
      where audio_title = $1 and audio_url is not null and media_until > now()
      order by media_until desc
      limit 1`,
    [title],
  )
  if (!rows[0]?.audio_url) return null
  return { url: String(rows[0].audio_url), post_id: String(rows[0].post_id) }
}
