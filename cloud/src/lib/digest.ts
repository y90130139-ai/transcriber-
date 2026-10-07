/**
 * The weekly digest — the week's top concepts, and what they had in common.
 *
 * "The week" is the library items *posted* Monday through Sunday, by
 * `upload_date`, because the question is what was working in the niche that
 * week, not what the Mac happened to finish transcribing.
 *
 * A winner is the same thing "why it worked" explains: 2×+ its creator's own
 * median plays from the sweep, or — for an item the sweep never measured — the
 * library's own flame (`is_hot`, which also demands enough posts behind the
 * median for one to mean anything). Ranking is by the sweep multiple first,
 * because that is plays, the number the 70/20/10 rule is written in; the
 * engagement multiple only orders what the sweep missed.
 *
 * "In common" is counted over the strongest twenty (DIGEST_BASIS), and reads
 * as "6 of the top 20" rather than a percentage — at these sizes a percentage
 * overstates what is really a handful of reels.
 *
 * Computed live for any week; nothing is stored. Plays keep moving after a
 * week closes, and a frozen copy would only disagree with the library.
 */
import { sql } from './db'
import { addDays } from './dates'
import { SCORING_COLUMNS, SCORING_CTE, SCORING_JOIN } from './hot'
import { preview } from './sql'
import { labelOf, type Axis } from './taxonomy'
import { REASON_NAME, type Reason, type Why } from './reasons'
import { FORMAT_GENERIC_SHARE, WORKED_MIN_MULTIPLE, whyItWorked } from './why'

/** How many winners the digest lists by name. */
export const DIGEST_TOP = 10
/** How many of the strongest winners the patterns are counted over. The
 *  library only holds picks, so 2×+ is nearly everything posted (115 of 130
 *  in the week of 2026-09-14) — a pattern across all of them is just the
 *  library's average. The top twenty is where "what the best had in common"
 *  actually means something. */
export const DIGEST_BASIS = 20
/** How many of each kind of pattern to report. */
const PATTERNS_PER_AXIS = 4
/** A pattern shared by fewer winners than this is a coincidence, not a pattern. */
const MIN_SHARED = 2
/** Hooks that name the absence of one. */
const NOT_A_HOOK = new Set(['none'])

export type DigestItem = {
  id: string
  author: string | null
  upload_date: string | null
  webpage_url: string | null
  has_thumb: boolean
  preview: string | null
  outperformance: number | null
  /** The library's own flame, which carries the 3-post guard. */
  is_hot: boolean
  why: Why | null
}

export type Count = { key: string; label: string; n: number }

export type Digest = {
  week_of: string
  /** Exclusive: the Monday after. */
  until: string
  posted: number
  winners: number
  /** Posted and winners on each of the week's seven days. */
  daily: { day: string; posted: number; winners: number }[]
  /** How many of the strongest winners `common` was counted over. */
  basis: number
  top: DigestItem[]
  common: {
    reasons: Count[]
    formats: Count[]
    hooks: Count[]
    personas: Count[]
    sounds: Count[]
    creators: Count[]
  }
  /** The digest in sentences, for a log line or a message. */
  headline: string[]
}

export async function digestFor(weekOf: string): Promise<Digest> {
  const until = addDays(weekOf, 7)

  const rows = await sql.query(
    `with ${SCORING_CTE}
     select t.job_id as id, t.author, t.upload_date, t.webpage_url,
            -- Already YYYY-MM-DD text; the plain column is the day.
            t.upload_date as upload_day,
            (t.thumbnail is not null) as has_thumb,
            ${preview('t.plain', 140, 't.on_screen_text')} as preview,
            ${SCORING_COLUMNS}
       from transcriber.transcripts t
       ${SCORING_JOIN}
      where t.upload_date >= $1 and t.upload_date < $2`,
    [weekOf, until],
  )

  const why = await whyItWorked(rows.map((row) => String(row.id)))

  const winners: DigestItem[] = rows
    .map((row) => ({
      id: String(row.id),
      author: row.author ? String(row.author) : null,
      upload_date: row.upload_date ? String(row.upload_date) : null,
      webpage_url: row.webpage_url ? String(row.webpage_url) : null,
      has_thumb: Boolean(row.has_thumb),
      preview: row.preview ? String(row.preview) : null,
      outperformance: row.outperformance === null ? null : Number(row.outperformance),
      is_hot: Boolean(row.is_hot),
      why: why.get(String(row.id)) ?? null,
    }))
    .filter(isWinner)
    .sort(byStrength)

  const best = winners.slice(0, DIGEST_BASIS)
  const ids = best.map((item) => item.id)
  // Formats on more than a third of the whole library (text overlay, thirst
  // trap) are house style, not a pattern — the same rule `why.ts` uses.
  const tags = ids.length === 0 ? [] : await sql.query(
    `with generic as (
       select tag from transcriber.tags where axis = 'format'
        group by tag
       having count(*) > $2::float * (select count(*) from transcriber.transcripts)
     )
     select axis, tag, count(distinct job_id)::int as n
       from transcriber.tags
      where job_id = any($1::text[]) and axis in ('format', 'hook', 'persona')
        and not (axis = 'format' and tag in (select tag from generic))
      group by axis, tag
      order by n desc, tag`,
    [ids, FORMAT_GENERIC_SHARE],
  )

  const byAxis = (axis: Axis): Count[] =>
    tags
      .filter((row) => row.axis === axis && Number(row.n) >= MIN_SHARED)
      .filter((row) => !(axis === 'hook' && NOT_A_HOOK.has(String(row.tag))))
      .slice(0, PATTERNS_PER_AXIS)
      .map((row) => ({ key: String(row.tag), label: labelOf(axis, String(row.tag)), n: Number(row.n) }))

  const reasons = allReasons(best)
  const common = {
    reasons: tally(reasons.map((r) => [r.kind, REASON_NAME[r.kind]])),
    formats: byAxis('format'),
    hooks: byAxis('hook'),
    personas: byAxis('persona'),
    sounds: tally(
      reasons.flatMap((r) => (r.kind === 'sound' ? [[r.title, r.title] as [string, string]] : [])),
    ).filter((row) => row.n >= MIN_SHARED).slice(0, PATTERNS_PER_AXIS),
    creators: tally(
      best.flatMap((item) => (item.author ? [[item.author, `@${item.author}`] as [string, string]] : [])),
    ).filter((row) => row.n >= MIN_SHARED).slice(0, PATTERNS_PER_AXIS),
  }

  // The week's rhythm, day by day: everything that went up, and which of it
  // popped. The line that shows a dead Tuesday or a runaway Saturday.
  const dayOf = new Map(rows.map((row) => [String(row.id), String(row.upload_day)]))
  const winnersByDay = new Map<string, number>()
  for (const winner of winners) {
    const day = dayOf.get(winner.id)
    if (day) winnersByDay.set(day, (winnersByDay.get(day) ?? 0) + 1)
  }
  const daily = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekOf, index)
    return {
      day,
      posted: rows.filter((row) => String(row.upload_day) === day).length,
      winners: winnersByDay.get(day) ?? 0,
    }
  })

  return {
    week_of: weekOf,
    until,
    posted: rows.length,
    winners: winners.length,
    daily,
    basis: best.length,
    top: winners.slice(0, DIGEST_TOP),
    common,
    headline: headline(winners.length, best.length, common),
  }
}

function isWinner(item: DigestItem): boolean {
  const multiple = item.why?.multiple ?? null
  if (multiple !== null) return multiple >= WORKED_MIN_MULTIPLE
  // `is_hot`, not a fresh `outperformance >= HOT_THRESHOLD`: the flame also
  // requires MIN_POSTS_FOR_HOT posts behind the median, and a two-post
  // creator's spike must not become a pattern here when it earns no flame
  // anywhere else.
  return item.is_hot
}

function byStrength(a: DigestItem, b: DigestItem): number {
  const x = a.why?.multiple ?? null
  const y = b.why?.multiple ?? null
  if (x !== null && y !== null) return y - x
  if (x !== null) return -1
  if (y !== null) return 1
  return (b.outperformance ?? 0) - (a.outperformance ?? 0)
}

function allReasons(items: DigestItem[]): Reason[] {
  return items.flatMap((item) => item.why?.reasons ?? [])
}

function tally(pairs: [string, string][]): Count[] {
  const counts = new Map<string, Count>()
  for (const [key, label] of pairs) {
    const seen = counts.get(key)
    counts.set(key, { key, label, n: (seen?.n ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

/** "Format: skit, 3 of the top 20" — the patterns, in words, strongest first.
 *  A tie is named as a tie rather than settled by alphabet. */
export function headline(winners: number, basis: number, common: Digest['common']): string[] {
  if (winners === 0) return ['No winners posted this week yet.']
  const of = (n: number) => `${n} of the top ${basis}`
  const lead = (rows: Count[]) => {
    const top = rows.filter((row) => row.n === rows[0]?.n)
    return top.length ? `${top.map((row) => row.label.toLowerCase()).join(' and ')}, ${of(top[0].n)}${top.length > 1 ? ' each' : ''}` : null
  }
  const lines = [
    `${winners} winner${winners === 1 ? '' : 's'} posted this week` +
      (basis < winners ? `; patterns below are from the strongest ${basis}.` : '.'),
  ]
  const format = lead(common.formats)
  if (format) lines.push(`Format: ${format}.`)
  const hook = lead(common.hooks)
  if (hook) lines.push(`Opening: ${hook}.`)
  const [sound] = common.sounds
  if (sound) lines.push(`Sound: "${sound.label}", ${of(sound.n)}.`)
  const fresh = common.reasons.find((row) => row.key === 'new')
  if (fresh) lines.push(`${of(fresh.n)} had no sound, streak or repeat format behind them — ideas worth testing.`)
  const [creator] = common.creators
  if (creator) lines.push(`${creator.label} had ${creator.n} of them.`)
  return lines
}
