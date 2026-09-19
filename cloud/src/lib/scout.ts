/**
 * Scout — the watchlist sweep that fills the library without anyone pasting.
 *
 * Once a week the Mac lists every watched creator's recent reels (metadata
 * only: plays, likes, comments, audio, collaborators) and posts them here as
 * *sightings*. This module keeps every sighting, measures each reel against
 * its own creator's median, and enqueues the ones that beat it into the same
 * `jobs` queue a paste goes into. From there nothing is new: the Mac fetches,
 * transcribes, OCRs and tags it, and Sunday's auto-draft can put it on a week.
 *
 * Two rules carried over from the ingest spec, both load-bearing:
 *
 *   1. **Two-phase.** The sweep is metadata only. Only winners are downloaded,
 *      or `out/` fills with a week of other people's filler.
 *   2. **The baseline is every post, not the kept ones.** `hot.ts` divides by
 *      the median of what is in the library — posts someone already chose
 *      because they were good — so it runs high and, below three kept posts,
 *      does not exist. Sightings are the creator's whole recent feed.
 *
 * Everything that decides a pick is a named constant below. A wrong pick is a
 * number to read and change, never a model to shrug at (constitution rule 3).
 */
import { nanoid } from 'nanoid'
import { sql } from './db'
import { normalizeUrl } from './links'

/** A reel must beat its creator's median plays by this much to be fetched.
 *
 *  **Measured 2026-09-19** over 921 in-window reels from 91 creators, the
 *  first real sweep: p50 1.0x, p90 5.21x, p95 10.87x. 5.0 is that top decile,
 *  the same rule HOT_THRESHOLD follows, and it takes a sweep from 238 picks
 *  (at the provisional 2.0) to 96 — a week a person can actually look at.
 *  Creators with tiny medians do not dominate it: reels from accounts under
 *  1k median plays are 8 of those 238. Re-measure after a full-roster sweep. */
export const PICK_MULTIPLIER = 5.0

/** Too few reels and "her median" is noise. Six is roughly a week of posting
 *  for this niche, and the first sweep pulls more than that per account. */
export const MIN_BASELINE_REELS = 6

/** The baseline looks back this far. Long enough to be steady, short enough
 *  that a creator who has grown is measured against who she is now. */
export const BASELINE_DAYS = 120

/** Only recent reels are worth making now, and plays need a day to mean
 *  anything — a two-hour-old reel at 3× has simply been seen by her core. */
export const PICK_WINDOW_DAYS = 14
export const SETTLE_HOURS = 24

/** One creator having a big week must not become the whole library, and one
 *  sweep must not bury the Mac. Three per creator, eighty per run. */
export const MAX_PICKS_PER_CREATOR = 3
export const MAX_PICKS_PER_RUN = 80

/** A comment is worth ten likes — the same weight `hot.ts` uses, so the
 *  fallback score reads like the one people already know. */
const COMMENT_WEIGHT = 10

const HANDLE = /^[a-z0-9._]{1,30}$/
const POST_ID = /^[A-Za-z0-9_-]{5,40}$/
const MAX_CAPTION = 2_200
const MAX_NAMES = 20

export type Sighting = {
  post_id: string
  handle: string
  url: string
  source_key: string
  posted_at: string | null
  plays: number | null
  likes: number | null
  comments: number | null
  duration_sec: number | null
  caption: string | null
  audio_id: string | null
  audio_title: string | null
  audio_artist: string | null
  original_audio: boolean | null
  collaborators: string[]
  tagged: string[]
  pinned: boolean
  via: 'apify' | 'burner'
  audio_url: string | null
  video_url: string | null
  poster_url: string | null
  media_until: string | null
}

export type Access = { handle: string; access: 'open' | 'gated' | 'missing' }

function count(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function handles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const raw of value) {
    const h = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^@/, '') : ''
    if (HANDLE.test(h)) seen.add(h)
  }
  return [...seen].slice(0, MAX_NAMES)
}

/** A signed CDN link, kept only while it is worth anything. */
function mediaUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') ? value.slice(0, 2_000) : null
}

/** Instagram signs its CDN links with an `oe` expiry in hex seconds. Reading
 *  it is what lets the fallback know whether it can use a stored link or must
 *  pay for a fresh one. */
export function expiryOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /[?&]oe=([0-9a-fA-F]{6,10})/.exec(value)
  if (!match) return null
  const seconds = parseInt(match[1], 16)
  if (!Number.isFinite(seconds) || seconds < 1_600_000_000) return null
  return new Date(seconds * 1000).toISOString()
}

/** Validate one sighting from the Mac. Anything malformed is dropped whole
 *  rather than half-written: a reel with no id or no creator cannot be scored
 *  or deduplicated, so it is worth nothing to store. */
export function parseSighting(raw: unknown): Sighting | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const postId = typeof r.post_id === 'string' ? r.post_id.trim() : ''
  const handle = typeof r.handle === 'string' ? r.handle.trim().toLowerCase() : ''
  if (!POST_ID.test(postId) || !HANDLE.test(handle)) return null
  const via = r.via === 'burner' ? 'burner' : r.via === 'apify' ? 'apify' : null
  if (!via) return null

  const url = `https://instagram.com/reel/${postId}`
  const posted = typeof r.posted_at === 'string' ? new Date(r.posted_at) : null
  return {
    post_id: postId,
    handle,
    url,
    source_key: normalizeUrl(url),
    posted_at: posted && !Number.isNaN(posted.getTime()) ? posted.toISOString() : null,
    plays: count(r.plays),
    likes: count(r.likes),
    comments: count(r.comments),
    duration_sec: typeof r.duration_sec === 'number' && r.duration_sec > 0 ? r.duration_sec : null,
    caption: text(r.caption, MAX_CAPTION),
    audio_id: text(r.audio_id, 60),
    audio_title: text(r.audio_title, 200),
    audio_artist: text(r.audio_artist, 200),
    original_audio: typeof r.original_audio === 'boolean' ? r.original_audio : null,
    collaborators: handles(r.collaborators).filter((h) => h !== handle),
    tagged: handles(r.tagged).filter((h) => h !== handle),
    pinned: r.pinned === true,
    via,
    audio_url: mediaUrl(r.audio_url),
    video_url: mediaUrl(r.video_url),
    poster_url: mediaUrl(r.poster_url),
    media_until: expiryOf(r.audio_url) ?? expiryOf(r.video_url),
  }
}

export function parseAccess(raw: unknown): Access | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const handle = typeof r.handle === 'string' ? r.handle.trim().toLowerCase() : ''
  const access = r.access
  if (!HANDLE.test(handle)) return null
  if (access !== 'open' && access !== 'gated' && access !== 'missing') return null
  return { handle, access }
}

/** Who to sweep, and how far back each one needs to go. A creator with no
 *  sightings yet needs a backfill deep enough to take a median from; everyone
 *  else only needs the pick window refreshed. */
export async function targets() {
  return sql.query(
    `select c.handle, c.access, c.swept_at,
            count(s.post_id)::int as sightings,
            max(s.posted_at) as newest
       from transcriber.creators c
       left join transcriber.sightings s on s.handle = c.handle
      where c.watch = 'watching'
      group by c.handle, c.access, c.swept_at
      order by c.handle`,
  )
}

/** Upsert a batch. Metrics and `seen_at` move on every sighting, because a
 *  reel's plays keep climbing; the first-seen time and any pick never move. */
export async function storeSightings(rows: Sighting[]): Promise<number> {
  if (rows.length === 0) return 0
  const written = await sql.query(
    `insert into transcriber.sightings
       (post_id, handle, url, source_key, posted_at, plays, likes, comments,
        duration_sec, caption, audio_id, audio_title, audio_artist, original_audio,
        collaborators, tagged, pinned, via, audio_url, video_url, poster_url, media_until)
     select x.post_id, x.handle, x.url, x.source_key, x.posted_at, x.plays, x.likes,
            x.comments, x.duration_sec, x.caption, x.audio_id, x.audio_title,
            x.audio_artist, x.original_audio,
            coalesce(x.collaborators, '{}'), coalesce(x.tagged, '{}'),
            coalesce(x.pinned, false), x.via, x.audio_url, x.video_url, x.poster_url, x.media_until
       from jsonb_to_recordset($1::jsonb) as x(
            post_id text, handle text, url text, source_key text, posted_at timestamptz,
            plays bigint, likes bigint, comments bigint, duration_sec real, caption text,
            audio_id text, audio_title text, audio_artist text, original_audio boolean,
            collaborators text[], tagged text[], pinned boolean, via text,
            audio_url text, video_url text, poster_url text, media_until timestamptz)
     on conflict (post_id) do update
        set plays          = coalesce(excluded.plays, transcriber.sightings.plays),
            likes          = coalesce(excluded.likes, transcriber.sightings.likes),
            comments       = coalesce(excluded.comments, transcriber.sightings.comments),
            caption        = coalesce(excluded.caption, transcriber.sightings.caption),
            audio_id       = coalesce(excluded.audio_id, transcriber.sightings.audio_id),
            audio_title    = coalesce(excluded.audio_title, transcriber.sightings.audio_title),
            audio_artist   = coalesce(excluded.audio_artist, transcriber.sightings.audio_artist),
            original_audio = coalesce(excluded.original_audio, transcriber.sightings.original_audio),
            -- An empty list is "this reader did not say", not "nobody": the
            -- burner and Apify see collaborators differently, and these
            -- columns are where suggestions come from.
            collaborators  = case when cardinality(excluded.collaborators) > 0
                                  then excluded.collaborators else transcriber.sightings.collaborators end,
            tagged         = case when cardinality(excluded.tagged) > 0
                                  then excluded.tagged else transcriber.sightings.tagged end,
            pinned         = excluded.pinned,
            -- Only ever move media links forward: a re-sighting with no links
            -- (or expired ones) must not blank a usable pair.
            audio_url      = coalesce(excluded.audio_url, transcriber.sightings.audio_url),
            video_url      = coalesce(excluded.video_url, transcriber.sightings.video_url),
            poster_url     = coalesce(excluded.poster_url, transcriber.sightings.poster_url),
            media_until    = greatest(excluded.media_until, transcriber.sightings.media_until),
            seen_at        = now()
     returning post_id`,
    [JSON.stringify(rows)],
  )
  return written.length
}

/** Record what the sweep learned about reading each account. */
export async function storeAccess(rows: Access[], swept: string[]): Promise<void> {
  if (rows.length > 0) {
    await sql.query(
      `update transcriber.creators c
          set access = x.access, access_at = now()
         from jsonb_to_recordset($1::jsonb) as x(handle text, access text)
        where c.handle = x.handle`,
      [JSON.stringify(rows)],
    )
  }
  if (swept.length > 0) {
    await sql.query(
      `update transcriber.creators set swept_at = now() where handle = any($1::text[])`,
      [swept],
    )
  }
}

/** A sighting of a post that is already in the library is the same post:
 *  link it, so the library row can show plays and never gets picked twice. */
async function linkExisting(): Promise<void> {
  await sql.query(
    `update transcriber.sightings s
        set job_id = j.id
       from transcriber.jobs j
      where s.job_id is null and j.source_key = s.source_key`,
  )
}

export type Pick = {
  post_id: string
  handle: string
  url: string
  source_key: string
  multiplier: number
  basis: 'plays' | 'engagement'
}

/** The reels that beat their creator's own median. Plays when there are
 *  enough of them to take a median from; engagement (likes + 10 × comments)
 *  when a creator's plays are hidden or missing. */
export async function candidates(): Promise<Pick[]> {
  const rows = await sql.query(
    `with base as (
       select handle,
              percentile_cont(0.5) within group (order by plays)
                filter (where plays is not null) as med_plays,
              count(*) filter (where plays is not null) as n_plays,
              percentile_cont(0.5) within group
                (order by coalesce(likes, 0) + ${COMMENT_WEIGHT} * coalesce(comments, 0)) as med_eng,
              count(*) as n
         from transcriber.sightings
        where not pinned and posted_at >= now() - interval '${BASELINE_DAYS} days'
        group by handle
     ),
     cand as (
       select s.post_id, s.handle, s.url, s.source_key,
              case when b.n_plays >= $1 and b.med_plays > 0 and s.plays is not null
                   then s.plays / b.med_plays end as x_plays,
              case when b.n >= $1 and b.med_eng > 0
                   then (coalesce(s.likes, 0) + ${COMMENT_WEIGHT} * coalesce(s.comments, 0)) / b.med_eng
              end as x_eng
         from transcriber.sightings s
         join base b on b.handle = s.handle
         join transcriber.creators c on c.handle = s.handle and c.watch = 'watching'
        where s.job_id is null and s.picked_at is null and not s.pinned
          and s.posted_at >= now() - interval '${PICK_WINDOW_DAYS} days'
          and s.posted_at <= now() - interval '${SETTLE_HOURS} hours'
     ),
     ranked as (
       select *, coalesce(x_plays, x_eng) as x,
              row_number() over (partition by handle order by coalesce(x_plays, x_eng) desc) as rn
         from cand
        where coalesce(x_plays, x_eng) >= $2
     )
     select post_id, handle, url, source_key, round(x::numeric, 2)::float as x,
            (x_plays is not null) as by_plays
       from ranked
      where rn <= $3
      order by x desc
      limit $4`,
    [MIN_BASELINE_REELS, PICK_MULTIPLIER, MAX_PICKS_PER_CREATOR, MAX_PICKS_PER_RUN],
  )
  return rows.map((r) => ({
    post_id: String(r.post_id),
    handle: String(r.handle),
    url: String(r.url),
    source_key: String(r.source_key),
    multiplier: Number(r.x),
    basis: r.by_plays ? 'plays' : 'engagement',
  }))
}

export function reasonFor(pick: Pick): string {
  return `${pick.multiplier}× @${pick.handle}'s median ${pick.basis}`
}

/** Put the winners in the queue — the same insert a paste does, so the
 *  `source_key` unique index is the dedupe and a re-sweep can never double a
 *  post. Returns how many were genuinely new. */
export async function enqueue(picks: Pick[], runId: string): Promise<number> {
  if (picks.length === 0) return 0
  const added = await sql.query(
    `insert into transcriber.jobs (id, kind, source, source_key, label, batch_id, transcribe)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                          $6::text[], $7::boolean[])
     on conflict (source_key) do nothing
     returning id`,
    [
      picks.map(() => nanoid(12)),
      picks.map(() => 'link'),
      picks.map((p) => p.url),
      picks.map((p) => p.source_key),
      picks.map((p) => `scout · ${reasonFor(p)}`.slice(0, 80)),
      picks.map(() => `scout-${runId}`),
      picks.map(() => true),
    ],
  )
  await sql.query(
    `update transcriber.sightings s
        set picked_at = now(), pick_reason = x.reason
       from jsonb_to_recordset($1::jsonb) as x(post_id text, reason text)
      where s.post_id = x.post_id`,
    [JSON.stringify(picks.map((p) => ({ post_id: p.post_id, reason: reasonFor(p) })))],
  )
  await linkExisting()
  return added.length
}

/** Collaborators and tagged accounts on this run's winners that we do not
 *  watch yet. They are written as *suggested* — never swept, never charged
 *  for — until a human taps Watch. A collab partner on a breakout reel is the
 *  best lead there is on who else is working in the niche. */
export async function suggest(postIds: string[]): Promise<number> {
  if (postIds.length === 0) return 0
  const rows = await sql.query(
    `insert into transcriber.creators (handle, display_name, watch, found_via)
     select distinct on (h) h, h, 'suggested', s.handle
       from transcriber.sightings s,
            unnest(s.collaborators || s.tagged) as h
      where s.post_id = any($1::text[])
      order by h, s.handle
     on conflict (handle) do nothing
     returning handle`,
    [postIds],
  )
  return rows.length
}

/** Sounds several watched creators picked up recently, rising first. Original
 *  audio is excluded: it is one creator's voice, not a trend anyone can join. */
export async function risingSounds(limit = 30) {
  return sql.query(
    `select audio_id,
            max(audio_title) as title,
            max(audio_artist) as artist,
            count(distinct handle) filter (where posted_at >= now() - interval '14 days')::int as creators_now,
            count(distinct handle) filter (where posted_at <  now() - interval '14 days'
                                             and posted_at >= now() - interval '28 days')::int as creators_before,
            max(plays) as top_plays,
            (array_agg(url order by plays desc nulls last))[1] as example
       from transcriber.sightings
      where audio_id is not null and original_audio is not true
        and posted_at >= now() - interval '28 days'
      group by audio_id
     having count(distinct handle) filter (where posted_at >= now() - interval '14 days') >= 2
      order by creators_now desc,
               count(distinct handle) filter (where posted_at >= now() - interval '14 days')
             - count(distinct handle) filter (where posted_at <  now() - interval '14 days'
                                                and posted_at >= now() - interval '28 days') desc
      limit $1`,
    [limit],
  )
}

/** The distribution the first sweep needs to set PICK_MULTIPLIER from: what
 *  share of recent reels clear each candidate threshold. */
export async function multiplierSpread() {
  return sql.query(
    `with base as (
       select handle, percentile_cont(0.5) within group (order by plays) as med,
              count(*) as n
         from transcriber.sightings
        where plays is not null and not pinned
          and posted_at >= now() - interval '${BASELINE_DAYS} days'
        group by handle
     ), x as (
       select s.plays / b.med as x
         from transcriber.sightings s join base b using (handle)
        where b.n >= $1 and b.med > 0 and s.plays is not null and not s.pinned
          and s.posted_at >= now() - interval '${PICK_WINDOW_DAYS} days'
     )
     select count(*)::int as reels,
            round(percentile_cont(0.5) within group (order by x)::numeric, 2)::float as p50,
            round(percentile_cont(0.75) within group (order by x)::numeric, 2)::float as p75,
            round(percentile_cont(0.9) within group (order by x)::numeric, 2)::float as p90,
            round(percentile_cont(0.95) within group (order by x)::numeric, 2)::float as p95,
            count(*) filter (where x >= 1.5)::int as over_1_5,
            count(*) filter (where x >= 2)::int   as over_2,
            count(*) filter (where x >= 3)::int   as over_3
       from x`,
    [MIN_BASELINE_REELS],
  )
}
