/**
 * Her run — what she sees when she taps the pill on her own plan.
 *
 * Everything here is already measured somewhere else: `bank.ts` grades her
 * posts against her own rolling median, `analytics.ts` counts her cadence. This
 * only puts them in her words and drops what she cannot be shown.
 *
 * Two rules, both from the manual:
 *
 * 1. **Only figures that are really readable.** Plays, likes, comments, shares
 *    and which days she posted. Saves and watch-through live in her Insights
 *    and nowhere else, so they never appear here — a number we cannot see is
 *    a number we would be inventing.
 * 2. **A miss is a gap, never a scolding.** The story row shows the days she
 *    posted and the days she did not, in her own week order, and the copy asks
 *    for the next one rather than mourning the last.
 */
import { bankFor, type BankPost } from './bank'
import { cadence } from './analytics'
import { sql } from './db'
import { jobMatchesCode } from './sql'

/** Six is what the strip holds without becoming a second library. */
const SHOWN = 6

export type RunReel = {
  post_id: string
  url: string
  /** The library job behind it, when her reel was ingested — that is what
   *  gives the card a still to show instead of a flat block. */
  job_id: string | null
  plays: number
  likes: number | null
  comments: number | null
  /** Her multiple of her own median, which is the only ranking that means
   *  anything across accounts of different sizes. */
  multiple: number
  /** Past 10x her normal: the manual's winner. */
  hot: boolean
  posted_at: string | null
  handle: string
}

export type Run = {
  name: string
  /** Null when no account of hers has enough history to take a median from. */
  median_plays: number | null
  window_days: number
  reels: RunReel[]
  totals: { plays: number; likes: number; best_multiple: number | null }
  week: {
    /** Monday-first, each day marked posted or not. */
    days: { letter: string; posted: boolean }[]
    story_days: number
    story_days_observed: number
    reels_posted: number
    longest_gap_days: number | null
  }
  /** Her streak in whole weeks, counted off consecutive weeks with a post. */
  weeks_unbroken: number
  /** Said plainly when there is nothing to show yet. */
  empty_because: string | null
}

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export async function runFor(modelId: string): Promise<Run | null> {
  const bank = await bankFor(modelId)
  if (!bank) return null

  const graded = [...bank.winners, ...bank.iterations]
  const best = [...graded].sort((a, b) => b.plays - a.plays).slice(0, SHOWN)
  const jobs = await jobsFor(best)

  const reels: RunReel[] = best.map((post) => ({
    post_id: post.post_id,
    url: post.url,
    job_id: jobs.get(post.post_id) ?? null,
    plays: post.plays,
    likes: post.likes,
    comments: post.comments,
    multiple: post.multiple,
    hot: post.grade === 'winner',
    posted_at: post.posted_at,
    handle: post.handle,
  }))

  // Her main account carries the cadence. Reading every account she runs would
  // count a day twice for a model who posts the same day on two of them, which
  // would show her a streak she has not had.
  const main = bank.accounts.find((account) => account.median_plays !== null) ?? bank.accounts[0]
  const beat = main ? await cadence(main.handle) : null
  const days = await postedDays(main?.handle ?? null)

  const median = bank.accounts
    .map((account) => account.median_plays)
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0] ?? null

  return {
    name: bank.name,
    median_plays: median,
    window_days: bank.window_days,
    reels,
    totals: {
      plays: reels.reduce((sum, reel) => sum + reel.plays, 0),
      likes: reels.reduce((sum, reel) => sum + (reel.likes ?? 0), 0),
      best_multiple: reels.length > 0 ? Math.max(...reels.map((reel) => reel.multiple)) : null,
    },
    week: {
      days,
      story_days: beat?.story_days ?? 0,
      story_days_observed: beat?.story_days_observed ?? 0,
      reels_posted: beat?.counts.reel ?? 0,
      longest_gap_days: beat?.longest_gap_days ?? null,
    },
    weeks_unbroken: await weeksUnbroken(main?.handle ?? null),
    empty_because: bank.empty
      ? 'Your reels are still being counted — this fills in as soon as there is enough to measure.'
      : null,
  }
}

/** The library rows behind her reels, so a card can show a still. */
async function jobsFor(posts: BankPost[]): Promise<Map<string, string>> {
  if (posts.length === 0) return new Map()
  const rows = await sql.query(
    `select x.code, j.id
       from unnest($1::text[]) as x(code)
       join transcriber.jobs j on ${jobMatchesCode('j.source', 'x.code')}
       join transcriber.transcripts t on t.job_id = j.id
      where t.thumbnail is not null`,
    [posts.map((post) => post.post_id)],
  )
  return new Map(rows.map((row) => [String(row.code), String(row.id)]))
}

/** The last seven days, Monday first, each marked posted or not. */
async function postedDays(handle: string | null): Promise<{ letter: string; posted: boolean }[]> {
  const blank = LETTERS.map((letter) => ({ letter, posted: false }))
  if (!handle) return blank

  const rows = await sql.query(
    `select distinct extract(isodow from posted_at)::int as dow
       from transcriber.creator_posts
      where handle = $1 and posted_at >= now() - interval '7 days'`,
    [handle],
  )
  const on = new Set(rows.map((row) => Number(row.dow)))
  return LETTERS.map((letter, index) => ({ letter, posted: on.has(index + 1) }))
}

/**
 * Consecutive weeks with at least one post, counted back from this one.
 *
 * Deliberately generous at the near end: a week she is still in counts as
 * unbroken until it ends, because a streak that resets every Monday morning is
 * a streak nobody can hold.
 */
async function weeksUnbroken(handle: string | null): Promise<number> {
  if (!handle) return 0
  const rows = await sql.query(
    `select distinct date_trunc('week', posted_at)::date as week
       from transcriber.creator_posts
      where handle = $1 and posted_at is not null
        and posted_at >= now() - interval '26 weeks'
      order by week desc`,
    [handle],
  )
  if (rows.length === 0) return 0

  const weeks = rows.map((row) => new Date(String(row.week)).getTime())
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const thisWeek = weeks[0]
  let run = 1
  for (let i = 1; i < weeks.length; i += 1) {
    if (thisWeek - weeks[i] === i * WEEK_MS) run += 1
    else break
  }
  return run
}
