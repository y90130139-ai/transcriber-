/**
 * What an account is actually doing, from the rows the sweeps leave behind.
 *
 * Two sources, because they answer different halves:
 *
 *   `creator_posts`     — every post, any type. Cadence and performance.
 *   `creator_snapshots` — the account header, once a day. Stories and growth.
 *
 * Handle-agnostic by design. Pointed at a watched creator this is competitive
 * intelligence; pointed at one of our models it is a posting scorecard. The
 * measurement does not change, only who is being measured.
 *
 * Every rate here is measured over a window and divided by the days actually
 * *covered*, never by the window length — an account swept for the first time
 * three days ago must not look like it went quiet for the other twenty-seven.
 */
import { sql } from './db'

/** What a model is expected to keep up. Geno's numbers, 2026-09-20. */
export const TARGET = {
  reelsPerDay: 3,
  carouselsPerWeek: 2,
  storyDaysPerWeek: 7,
} as const

const DAY = 86_400_000

export type Cadence = {
  handle: string
  window_days: number
  days_covered: number
  counts: { reel: number; carousel: number; photo: number; video: number }
  reels_per_day: number | null
  carousels_per_week: number | null
  story_days: number
  story_days_observed: number
  longest_gap_days: number | null
  last_posted_at: string | null
  meets: { reels: boolean | null; carousels: boolean | null; stories: boolean | null }
}

export type TopPost = {
  post_id: string
  posted_at: string | null
  kind: string | null
  plays: number | null
  likes: number | null
  comments: number | null
  caption: string | null
  audio_title: string | null
}

/** Posting rates, story days, and whether the targets were met. */
export async function cadence(handle: string, windowDays = 30): Promise<Cadence> {
  const since = new Date(Date.now() - windowDays * DAY).toISOString()

  const posts = await sql.query(
    `select kind, posted_at
       from transcriber.creator_posts
      where handle = $1 and posted_at is not null and posted_at >= $2::timestamptz
      order by posted_at`,
    [handle, since],
  )

  // Stories can only be counted from days we actually looked. A day with no
  // snapshot is unknown, not a miss, and saying otherwise would invent misses
  // for every day before the daily pass existed.
  const [story] = await sql.query(
    `select count(distinct date_trunc('day', seen_at)) filter (where has_story)::int as days,
            count(distinct date_trunc('day', seen_at))::int as observed
       from transcriber.creator_snapshots
      where handle = $1 and seen_at >= $2::timestamptz`,
    [handle, since],
  )

  const counts = { reel: 0, carousel: 0, photo: 0, video: 0 }
  const times: number[] = []
  for (const row of posts) {
    const kind = String(row.kind ?? '') as keyof typeof counts
    if (kind in counts) counts[kind] += 1
    times.push(new Date(String(row.posted_at)).getTime())
  }

  // Coverage runs from the first post seen in the window (or the window's
  // start, whichever is later) to now — the span we can honestly speak for.
  const first = times.length ? Math.min(...times) : null
  const daysCovered = first === null
    ? 0
    : Math.max(1, Math.round((Date.now() - Math.max(first, Date.now() - windowDays * DAY)) / DAY))

  let longest: number | null = null
  for (let i = 1; i < times.length; i += 1) {
    const gap = (times[i] - times[i - 1]) / DAY
    if (longest === null || gap > longest) longest = gap
  }

  const reelsPerDay = daysCovered ? counts.reel / daysCovered : null
  const carouselsPerWeek = daysCovered ? (counts.carousel / daysCovered) * 7 : null
  const storyDays = Number(story?.days ?? 0)
  const observed = Number(story?.observed ?? 0)

  return {
    handle,
    window_days: windowDays,
    days_covered: daysCovered,
    counts,
    reels_per_day: reelsPerDay === null ? null : round(reelsPerDay, 2),
    carousels_per_week: carouselsPerWeek === null ? null : round(carouselsPerWeek, 2),
    story_days: storyDays,
    story_days_observed: observed,
    longest_gap_days: longest === null ? null : round(longest, 1),
    last_posted_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
    meets: {
      reels: reelsPerDay === null ? null : reelsPerDay >= TARGET.reelsPerDay,
      carousels: carouselsPerWeek === null ? null : carouselsPerWeek >= TARGET.carouselsPerWeek,
      // Unknown until we have actually looked on a few days, rather than a
      // confident "missed" on day one.
      stories: observed < 3 ? null : storyDays / observed >= 0.5,
    },
  }
}

/** Their best posts in the window, by plays. */
export async function topPosts(handle: string, windowDays = 30, limit = 10): Promise<TopPost[]> {
  const since = new Date(Date.now() - windowDays * DAY).toISOString()
  const rows = await sql.query(
    `select post_id, posted_at, kind, plays, likes, comments, caption, audio_title
       from transcriber.creator_posts
      where handle = $1 and plays is not null
        and (posted_at is null or posted_at >= $2::timestamptz)
      order by plays desc
      limit $3`,
    [handle, since, limit],
  )
  // `plays`, `likes` and `comments` are bigint, and the driver hands those back
  // as strings to keep 64-bit values exact. Passing them through untouched
  // means a caller that formats or compares them is working on text: "9" sorts
  // above "10", and a thousands separator throws. Coerce at the boundary.
  return rows.map((row) => ({
    post_id: String(row.post_id),
    posted_at: row.posted_at ? String(row.posted_at) : null,
    kind: row.kind ? String(row.kind) : null,
    plays: count(row.plays),
    likes: count(row.likes),
    comments: count(row.comments),
    caption: row.caption ? String(row.caption) : null,
    audio_title: row.audio_title ? String(row.audio_title) : null,
  }))
}

function count(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Follower movement across the window, from the daily snapshots. */
export async function growth(handle: string, windowDays = 30) {
  const since = new Date(Date.now() - windowDays * DAY).toISOString()
  const rows = await sql.query(
    `select seen_at, followers, posts, has_story
       from transcriber.creator_snapshots
      where handle = $1 and seen_at >= $2::timestamptz and followers is not null
      order by seen_at`,
    [handle, since],
  )
  if (rows.length === 0) return { readings: 0, followers_now: null, followers_gained: null }
  const first = Number(rows[0].followers)
  const last = Number(rows[rows.length - 1].followers)
  return {
    readings: rows.length,
    followers_now: last,
    followers_gained: rows.length > 1 ? last - first : null,
  }
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
