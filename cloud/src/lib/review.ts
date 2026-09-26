/**
 * Her week, reviewed — the manual's T3 and the Sunday call sheet (Step 7b).
 *
 * Grades every reel she posted that week against her own median, gives each an
 * action, checks the 70/20/10 drift on what she actually posted, sets it
 * against what she was sent, and writes what to say on the call. Every piece
 * existed somewhere — `mix.ts` measured drift, `split.ts` drafts, `why.ts`
 * explains — and nothing was "her week, reviewed". This is that object.
 *
 * Grades follow the decisions in docs/CREATIVE-DIRECTOR.md: a winner is 10x
 * her own median. Views only; watch-through, saves and subs are not readable
 * from outside and nothing here implies otherwise. Subs are Geno's to line up
 * by date — every post here carries its date for exactly that.
 */
import { sql } from './db'
import { addDays } from './dates'
import { bankFor } from './bank'
import { THRESHOLD } from './mix'

export type Grade = 'Flop' | 'Below avg' | 'Average' | 'Good' | 'Winner' | 'Viral'
export type Action = 'Reskin' | 'Iterate' | 'Test again' | 'Stop'

/** Multiples of her own median. Winner is the 10x decision; Viral is where a
 *  post is no longer a winner but an event, and worth saying so on the call. */
export const GRADES: [number, Grade][] = [
  [30, 'Viral'],
  [THRESHOLD.reskin, 'Winner'],
  [THRESHOLD.iteration, 'Good'],
  [1, 'Average'],
  [0.5, 'Below avg'],
  [0, 'Flop'],
]

const ACTION: Record<Grade, Action> = {
  Viral: 'Reskin',
  Winner: 'Reskin',
  Good: 'Iterate',
  Average: 'Test again',
  // Just under her normal is noise, not a verdict — it gets another go. Only a
  // flop, under half her normal, is a concept worth dropping.
  'Below avg': 'Test again',
  Flop: 'Stop',
}

export type ReviewedPost = {
  post_id: string
  handle: string
  posted_at: string
  kind: string | null
  plays: number | null
  multiple: number | null
  grade: Grade | null
  action: Action | null
  url: string
  caption: string | null
}

export type Review = {
  model_id: string
  name: string
  week_of: string
  posts: ReviewedPost[]
  counts: { reels: number; carousels: number; photos: number }
  /** Posted reels by bucket, against 70/20/10. */
  mix: { winners: number; good: number; rest: number }
  /** What she was sent that week, and how much of it was filmed. */
  plan: { sent: number; filmed: number; declined: number } | null
  /** The Sunday call, in the order it should be said. */
  call: string[]
}

function gradeOf(multiple: number | null): Grade | null {
  if (multiple === null) return null
  return GRADES.find(([floor]) => multiple >= floor)?.[1] ?? 'Flop'
}

export async function reviewFor(modelId: string, weekOf: string): Promise<Review | null> {
  const bank = await bankFor(modelId)
  if (!bank) return null
  const until = addDays(weekOf, 7)
  const medians = new Map(bank.accounts.map((account) => [account.handle, account.median_plays]))
  const handles = [...medians.keys()]

  const rows = handles.length === 0 ? [] : await sql.query(
    `select post_id, handle, posted_at, kind, plays, caption
       from transcriber.creator_posts
      where handle = any($1::text[])
        and posted_at >= $2::date and posted_at < $3::date
      order by posted_at`,
    [handles, weekOf, until],
  )

  const posts: ReviewedPost[] = rows.map((row) => {
    const median = medians.get(String(row.handle)) ?? null
    const plays = row.plays === null ? null : Number(row.plays)
    const multiple = row.kind === 'reel' && plays !== null && median
      ? Math.round((plays / median) * 100) / 100
      : null
    const grade = gradeOf(multiple)
    return {
      post_id: String(row.post_id),
      handle: String(row.handle),
      posted_at: String(row.posted_at),
      kind: row.kind ? String(row.kind) : null,
      plays,
      multiple,
      grade,
      action: grade ? ACTION[grade] : null,
      url: `https://www.instagram.com/${row.kind === 'reel' ? 'reel' : 'p'}/${row.post_id}/`,
      caption: row.caption ? String(row.caption).slice(0, 140) : null,
    }
  })

  const [plan] = await sql.query(
    `select count(i.*)::int as sent,
            count(i.*) filter (where i.filmed_at is not null)::int as filmed,
            count(i.*) filter (where i.declined_at is not null)::int as declined
       from transcriber.plans p
       left join transcriber.plan_items i on i.plan_id = p.id
      where p.model_id = $1 and p.week_of = $2::date and p.status = 'sent'
      group by p.id`,
    [modelId, weekOf],
  )

  const reels = posts.filter((post) => post.kind === 'reel')
  const graded = reels.filter((post) => post.multiple !== null)
  const winners = graded.filter((post) => post.grade === 'Winner' || post.grade === 'Viral')
  const good = graded.filter((post) => post.grade === 'Good')
  const stops = graded.filter((post) => post.action === 'Stop')

  return {
    model_id: bank.model_id,
    name: bank.name,
    week_of: weekOf,
    posts,
    counts: {
      reels: reels.length,
      carousels: posts.filter((post) => post.kind === 'carousel').length,
      photos: posts.filter((post) => post.kind === 'photo').length,
    },
    mix: { winners: winners.length, good: good.length, rest: graded.length - winners.length - good.length },
    plan: plan ? { sent: Number(plan.sent), filmed: Number(plan.filmed), declined: Number(plan.declined) } : null,
    call: callSheet(reels.length, graded, winners, good, stops, plan ?? null),
  }
}

/**
 * What to say on Sunday, warm and direct — the manual's order: what worked,
 * what we repeat, what we stop, what is next. Wins first, always; the manual
 * is explicit that she has to see the results of her effort to stay in it.
 */
function callSheet(
  reelCount: number,
  graded: ReviewedPost[],
  winners: ReviewedPost[],
  good: ReviewedPost[],
  stops: ReviewedPost[],
  plan: { sent?: unknown; filmed?: unknown; declined?: unknown } | null,
): string[] {
  const lines: string[] = []
  if (reelCount === 0) {
    return ['No reels posted this week that the sweep could see. Start there: what got in the way?']
  }
  const best = [...graded].sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))[0]
  if (winners.length > 0) {
    lines.push(
      `Lead with the win: ${winners.length} reel${winners.length === 1 ? '' : 's'} went past 10× their normal` +
      (best?.multiple ? ` — the best did ${Math.round(best.multiple)}×.` : '.') +
      ' Every one of those becomes five more next week.',
    )
  } else if (best?.multiple) {
    lines.push(`Best of the week did ${best.multiple}× their normal. Say it — progress they can see keeps them filming.`)
  }
  if (good.length > 0) {
    lines.push(`${good.length} did well without breaking out. Those get one more go, unchanged, to see if it was the idea or the day.`)
  }
  if (stops.length > 0) {
    lines.push(
      `${stops.length} landed under half their normal. Drop those concepts — no need to ` +
      'dwell on them, just do not repeat them.',
    )
  }
  if (plan) {
    const sent = Number(plan.sent)
    const filmed = Number(plan.filmed)
    const declined = Number(plan.declined)
    if (sent > 0) {
      lines.push(
        `They filmed ${filmed} of the ${sent} sent.` +
        (declined ? ` ${declined} declined — ask what did not feel like them, and listen.` : '') +
        (filmed < sent / 2 ? ' Less than half: find out whether it was time, places to film, or the ideas.' : ''),
      )
    }
  }
  lines.push(`They posted ${reelCount} reel${reelCount === 1 ? '' : 's'} this week against a target of 21. Confirm their shoot day for next week before hanging up.`)
  return lines
}
