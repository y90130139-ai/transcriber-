/**
 * The Winners Bank — her own posts, graded against her own median.
 *
 * This is the store the 70% is drawn from, and until now it did not exist.
 * `batch.ts` builds a week out of *other creators'* reels, which in the
 * manual's vocabulary makes every card a New Test: we were running the 10% and
 * calling it the plan. A reskin cannot be drafted from a stranger's reel. It
 * has to come from something that already won on her own account.
 *
 * Handle-agnostic in the same way the rest of the analytics layer is, with one
 * difference that matters: a model is not a handle. She may run three
 * Instagrams, so her baseline is taken **per account** and her bank is the
 * union. A backup account posting at a tenth of the main one's reach would
 * otherwise drag her median down and promote its own mediocre posts into
 * winners.
 *
 * Grades, settled in docs/CREATIVE-DIRECTOR.md:
 *
 *   winner     >= 10x her 30-day median plays    -> the 70%, via the ladder
 *   iteration  3x - 10x                          -> the 20%, run it again
 *   rest       below 3x                          -> not drawn from
 *
 * The manual gives three definitions of "winner" and two of them need saves and
 * watch-through. Instagram does not expose either outside her own Insights, so
 * they are not computable here and nothing pretends otherwise. Shares per 1,000
 * plays is carried because it *is* public (`media_repost_count`) and it breaks
 * ties between two posts at the same multiple.
 */
import { sql } from './db'
import { MEDIAN_DAYS, THRESHOLD } from './mix'
import { instagramAccounts, readSocials } from './socials'

/** Posts needed on an account before its median means anything. Matches
 *  `mix.ts`: below this the number is a coin toss, not a baseline. */
const MIN_HISTORY = 5

/** How far back a winner may have been posted and still be worth reskinning.
 *  Her audience has moved on past this, and so has the algorithm. */
export const BANK_WINDOW_DAYS = 90

export type Grade = 'winner' | 'iteration' | 'rest'

export type BankPost = {
  post_id: string
  handle: string
  posted_at: string | null
  plays: number
  likes: number | null
  comments: number | null
  /** Shares per 1,000 plays — public, and the tiebreak between equal multiples. */
  shares_per_1k: number | null
  multiple: number
  grade: Grade
  /** Rebuilt from the shortcode: what the ingest fetches and what she reopens. */
  url: string
}

export type AccountBank = {
  handle: string
  median_plays: number | null
  history: number
  /** Which window the median was taken over — see `medianFor`. */
  basis: 'rolling-30d' | 'widened-90d' | 'none'
  /** Reels with plays but no date. They cannot be graded and are not silently
   *  dropped: see the note in `bankFor`. */
  undated: number
  /** Why this account cannot be graded, when it cannot. */
  unreadable?: string
}

export type Bank = {
  model_id: string
  name: string
  accounts: AccountBank[]
  winners: BankPost[]
  iterations: BankPost[]
  /** True when no account has enough history to grade anything yet. */
  empty: boolean
  window_days: number
}

export function gradeOf(multiple: number): Grade {
  if (multiple >= THRESHOLD.reskin) return 'winner'
  if (multiple >= THRESHOLD.iteration) return 'iteration'
  return 'rest'
}

/** One model's bank: every Instagram she runs, graded separately, merged. */
export async function bankFor(modelId: string): Promise<Bank | null> {
  const [model] = await sql.query(
    `select id, name, handle, socials from transcriber.models where id = $1`,
    [modelId],
  )
  if (!model) return null

  const handles = instagramAccounts(
    model.handle as string | null,
    readSocials(model.socials),
  )
  const accounts: AccountBank[] = []
  const winners: BankPost[] = []
  const iterations: BankPost[] = []

  for (const handle of handles) {
    const rows = await sql.query(
      `select post_id, posted_at, plays, likes, comments, reposts
         from transcriber.creator_posts
        where handle = $1 and kind = 'reel' and plays is not null
          and (posted_at is null or posted_at >= now() - ($2 || ' days')::interval)
        order by posted_at desc nulls last`,
      [handle, String(BANK_WINDOW_DAYS)],
    )

    // Reels the sweep read with a play count but no date. The reader merges two
    // tabs — the timeline carries `taken_at`, the reels tab carries the play
    // count — so a reel that appeared only in the reels tab has counts and no
    // date. It cannot be placed in a window, so it cannot be graded, and
    // guessing its age would be inventing the one number the grade turns on.
    // Counted here so an account short of history says which of the two
    // reasons it is short for.
    const dated = rows.filter((row) => row.posted_at !== null)
    const undated = rows.length - dated.length

    const { median, basis, history } = medianFor(dated)
    accounts.push({ handle, median_plays: median, history, basis, undated })
    if (median === null || median <= 0) {
      accounts[accounts.length - 1].unreadable =
        `${history} dated reel${history === 1 ? '' : 's'} with plays` +
        (undated ? `, and ${undated} more the sweep could not date` : '') +
        ` — a median needs ${MIN_HISTORY}.`
      continue
    }

    for (const row of dated) {
      const count = Number(row.plays)
      const multiple = round(count / median, 2)
      const grade = gradeOf(multiple)
      if (grade === 'rest') continue
      const reposts = row.reposts === null ? null : Number(row.reposts)
      const post: BankPost = {
        post_id: String(row.post_id),
        handle,
        posted_at: row.posted_at ? String(row.posted_at) : null,
        plays: count,
        likes: row.likes === null ? null : Number(row.likes),
        comments: row.comments === null ? null : Number(row.comments),
        shares_per_1k: reposts === null || count === 0
          ? null
          : round((reposts / count) * 1000, 1),
        multiple,
        grade,
        url: `https://www.instagram.com/reel/${row.post_id}/`,
      }
      ;(grade === 'winner' ? winners : iterations).push(post)
    }
  }

  return {
    model_id: String(model.id),
    name: String(model.name),
    accounts,
    winners: winners.sort(strongestFirst),
    iterations: iterations.sort(strongestFirst),
    empty: accounts.every((account) => account.median_plays === null),
    window_days: BANK_WINDOW_DAYS,
  }
}

/**
 * Her median, and how far back it had to reach to find one.
 *
 * The manual says a rolling 30-day median, and that is what runs when there is
 * enough in 30 days. Below `MIN_HISTORY` the window widens to the bank window
 * rather than returning nothing: a model who posts twice a week is not a model
 * we cannot measure, and a baseline off her own last 90 days beats no baseline
 * at all. Which window was used travels with the answer, because a 90-day
 * median on a growing account runs low and its multiples run high.
 */
function medianFor(rows: { posted_at?: unknown; plays?: unknown }[]): {
  median: number | null
  basis: AccountBank['basis']
  history: number
} {
  const recent = rows.filter((row) => withinDays(row.posted_at, MEDIAN_DAYS))
  if (recent.length >= MIN_HISTORY) {
    return { median: medianOf(recent), basis: 'rolling-30d', history: recent.length }
  }
  if (rows.length >= MIN_HISTORY) {
    return { median: medianOf(rows), basis: 'widened-90d', history: rows.length }
  }
  return { median: null, basis: 'none', history: rows.length }
}

function medianOf(rows: { plays?: unknown }[]): number {
  const plays = rows.map((row) => Number(row.plays)).sort((a, b) => a - b)
  const mid = Math.floor(plays.length / 2)
  return plays.length % 2 ? plays[mid] : (plays[mid - 1] + plays[mid]) / 2
}

/** Highest multiple first; shares break a tie, because a post people sent on
 *  is a better thing to make five more of than one they only watched. */
function strongestFirst(a: BankPost, b: BankPost): number {
  return b.multiple - a.multiple || (b.shares_per_1k ?? 0) - (a.shares_per_1k ?? 0)
}

function withinDays(value: unknown, days: number): boolean {
  if (!value) return false
  const at = Date.parse(String(value))
  return Number.isFinite(at) && Date.now() - at <= days * 86_400_000
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
