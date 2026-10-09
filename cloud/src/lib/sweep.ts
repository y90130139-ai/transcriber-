/**
 * The daily sweep: what is waiting on us, and what is waiting on her.
 *
 * The console has always been able to answer "how many videos does she have
 * this week" and never "is anyone stuck". A count of four is the same number
 * whether the brief went out on Sunday and she is filming, or whether it is
 * still a draft nobody has sent — and those are opposite situations.
 *
 * Everything here is computed from columns that already exist. Two rules run
 * through all of it:
 *
 *   1. Supply is reported next to delivery. A model with nothing filmed is not
 *      the same as a model who was never sent anything, and a scoreboard that
 *      shows only her half is a scoreboard that blames her for our week.
 *   2. Nothing is a judgement. Each list is a plain condition, stated on the
 *      row, so a red flag can be argued with rather than only obeyed.
 */
import { sql } from './db'
import { currentWeekOf, todayIn } from './dates'

/** How long after a plan is sent before hearing nothing back is worth saying.
 *  Under two days it is just the weekend. */
const SILENT_AFTER_DAYS = 2

/** How many weeks the scoreboard looks back over. Long enough to be a habit,
 *  short enough that a bad fortnight in June is not still on the board. */
const SCORE_WEEKS = 8

/** A week is "on time" when the brief was in her hands before the week it is
 *  for actually started. Sent on the Wednesday is late even if she films it. */
export type Score = {
  weeks: number
  sent: number
  sentOnTime: number
  items: number
  accepted: number
  declined: number
  filmed: number
  posted: number
}

export type SweepRow = {
  id: string
  name: string
  handle: string | null
  photo_url: string | null
  tier: 'A' | 'B' | 'C'
  status: 'active' | 'paused'
  timezone: string
  filming_days: number[]
  plan_id: string | null
  plan_status: 'draft' | 'sent' | null
  due_date: string | null
  sent_on: string | null
  items: number
  filmed: number
  accepted: number
  declined: number
  posted: number
  unread: number
  /** Days until the due date where she is. Negative once it is past. */
  days_left: number | null
  /** Days since the plan was sent, or null if it never was. */
  days_since_sent: number | null
  /** Whether she has answered anything at all on this week. */
  answered: boolean
  /** Whether she has ever opened the link for this week. Null on any plan sent
   *  before the column existed — which is not the same statement as false, and
   *  is why the lists below treat null as "cannot tell". */
  opened: boolean | null
}

export type LibraryHealth = {
  held: number
  unused: number
  untagged: number
  failed: number
  /** Models whose formats are unset, which makes their suggestions return
   *  nothing at all — an empty "Suggested for her" reads as a dry library when
   *  it is really an unfilled profile. */
  unprofiled: number
}

/**
 * One reel sitting on more than one active model's current week.
 *
 * `match.ts` excludes what is already assigned, but per model — so the same
 * strong reel is the top suggestion for everybody at once and nothing said so.
 * The scaling plan assumes one good reel feeds twenty creators on a stagger;
 * this is the only place that stagger is visible at all.
 *
 * Reported, never prevented. Geno sometimes genuinely wants two creators on one
 * trend, and a sweep that hid the choice would be worse than one that names it.
 */
export type SweepCollision = {
  job_id: string
  author: string | null
  /** How many active models are carrying it this week. Always two or more. */
  models: number
  /** Their names, in one line — this is a heading, not a table. */
  names: string
}

export type Sweep = {
  weekOf: string
  rows: SweepRow[]
  ourSide: string[]
  slipped: string[]
  /** Kept exactly as it was: everyone who has said nothing back. The roster
   *  card reads this one, and splitting it in place would have quietly changed
   *  what a flag on that card means. */
  silent: string[]
  /** The same set, split by whether the link was ever opened. Silence from
   *  someone who never opened it is a delivery problem; silence from someone
   *  who did is a conversation. Opposite responses, so they are two lists. */
  neverOpened: string[]
  openedNoAnswer: string[]
  overdue: string[]
  questions: string[]
  collisions: SweepCollision[]
  library: LibraryHealth
  score: Score
}

const MS_PER_DAY = 86_400_000

/** Whole days from `from` to `to`, both plain `YYYY-MM-DD`.
 *
 *  Parsed as UTC midnight on both sides rather than through `new Date(string)`,
 *  which is how a due date lands a day early in Hawaii. */
function daysBetween(from: string, to: string): number {
  const at = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((at(to) - at(from)) / MS_PER_DAY)
}

/** Has a filming day already gone by this week, where she is? */
function filmingDayPassed(filmingDays: number[], timezone: string, weekOf: string): boolean {
  if (filmingDays.length === 0) return false
  const today = todayIn(timezone)
  const elapsed = daysBetween(weekOf, today) // 0 on the Monday
  if (elapsed < 0) return false
  // filming_days is 0=Sunday..6=Saturday; the week starts on its Monday.
  const dayOfWeek = (offset: number) => ((offset + 1) % 7)
  for (let offset = 0; offset < Math.min(elapsed, 6); offset += 1) {
    if (filmingDays.includes(dayOfWeek(offset))) return true
  }
  return false
}

export async function loadSweep(): Promise<Sweep> {
  const weekOf = currentWeekOf()

  const rows = await sql.query(
    `select m.id, m.name, m.handle, m.photo_url, m.tier, m.status,
            m.timezone, m.filming_days,
            w.plan_id, w.plan_status,
            to_char(w.due_date, 'YYYY-MM-DD') as due_date,
            to_char(w.sent_at at time zone m.timezone, 'YYYY-MM-DD') as sent_on,
            (w.opened_at is not null) as opened,
            coalesce(w.items, 0)::int    as items,
            coalesce(w.filmed, 0)::int   as filmed,
            coalesce(w.accepted, 0)::int as accepted,
            coalesce(w.declined, 0)::int as declined,
            coalesce(w.posted, 0)::int   as posted,
            coalesce(w.answered, false)  as answered,
            coalesce(u.unread, 0)::int   as unread
       from transcriber.models m
       left join lateral (
         select p.id as plan_id, p.status as plan_status, p.due_date, p.sent_at,
                p.opened_at,
                count(i.id) as items,
                count(i.id) filter (where i.filmed_at is not null)    as filmed,
                count(i.id) filter (where i.accepted_at is not null)  as accepted,
                count(i.id) filter (where i.declined_at is not null)  as declined,
                count(i.id) filter (where i.posted_at is not null)    as posted,
                -- Any answer at all: a verdict either way, or a word from her.
                bool_or(i.accepted_at is not null or i.declined_at is not null
                        or exists (select 1 from transcriber.plan_messages n
                                    where n.item_id = i.id and n.author = 'model'))
                  as answered
           from transcriber.plans p
           left join transcriber.plan_items i on i.plan_id = p.id
          where p.model_id = m.id and p.week_of = $1::date
          group by p.id
       ) w on true
       left join lateral (
         select count(*) as unread
           from transcriber.plan_messages n
           join transcriber.plan_items i on i.id = n.item_id
           join transcriber.plans p on p.id = i.plan_id
          where p.model_id = m.id and n.author = 'model' and n.seen_at is null
       ) u on true
      order by m.tier, (m.status = 'active') desc, m.name`,
    [weekOf],
  )

  const sweep: SweepRow[] = rows.map((row) => {
    const timezone = String(row.timezone ?? 'America/New_York')
    const today = todayIn(timezone)
    const due = (row.due_date as string | null) ?? null
    const sentOn = (row.sent_on as string | null) ?? null
    return {
      id: String(row.id),
      name: String(row.name),
      handle: (row.handle as string | null) ?? null,
      photo_url: (row.photo_url as string | null) ?? null,
      tier: (row.tier as 'A' | 'B' | 'C') ?? 'B',
      status: row.status === 'paused' ? 'paused' : 'active',
      timezone,
      filming_days: Array.isArray(row.filming_days) ? (row.filming_days as number[]) : [],
      plan_id: (row.plan_id as string | null) ?? null,
      plan_status: (row.plan_status as 'draft' | 'sent' | null) ?? null,
      due_date: due,
      sent_on: sentOn,
      items: Number(row.items ?? 0),
      filmed: Number(row.filmed ?? 0),
      accepted: Number(row.accepted ?? 0),
      declined: Number(row.declined ?? 0),
      posted: Number(row.posted ?? 0),
      unread: Number(row.unread ?? 0),
      days_left: due ? daysBetween(today, due) : null,
      days_since_sent: sentOn ? daysBetween(sentOn, today) : null,
      answered: Boolean(row.answered),
      opened: row.opened === null || row.opened === undefined ? null : Boolean(row.opened),
    }
  })

  // Paused models are off every list. Pausing someone is the operator saying
  // "not this week", and a sweep that keeps nagging about her is a sweep that
  // stops being read.
  const live = sweep.filter((row) => row.status === 'active')

  const ourSide = live
    .filter((row) => row.plan_status !== 'sent' || row.items === 0)
    .map((row) => row.id)

  const slipped = live
    .filter((row) =>
      row.plan_status === 'sent' &&
      row.items > 0 &&
      row.filmed === 0 &&
      filmingDayPassed(row.filming_days, row.timezone, weekOf))
    .map((row) => row.id)

  const silent = live
    .filter((row) =>
      row.plan_status === 'sent' &&
      row.items > 0 &&
      !row.answered &&
      (row.days_since_sent ?? 0) >= SILENT_AFTER_DAYS)
    .map((row) => row.id)

  // Silence, split by whether the link was ever opened. A plan sent before
  // `opened_at` existed reports null, and lands in neither list rather than
  // being asserted as unopened — the column cannot know about a week it was
  // not there for.
  const silentRows = live.filter((row) =>
    row.plan_status === 'sent' &&
    row.items > 0 &&
    !row.answered &&
    (row.days_since_sent ?? 0) >= SILENT_AFTER_DAYS)

  const neverOpened = silentRows.filter((row) => row.opened === false).map((row) => row.id)
  const openedNoAnswer = silentRows.filter((row) => row.opened === true).map((row) => row.id)

  const overdue = live
    .filter((row) =>
      row.plan_status === 'sent' &&
      row.items > 0 &&
      row.days_left !== null && row.days_left < 0 &&
      row.filmed < row.items)
    .map((row) => row.id)

  const questions = live.filter((row) => row.unread > 0).map((row) => row.id)

  // The same reel on two active weeks at once. Scoped to this week and to
  // active models: a collision with a paused model, or with a week that has
  // already been and gone, is not a thing to do anything about today.
  // Collisions, library health and the send score are independent — one wait
  // instead of three (2026-10-09).
  const [collisions, healthRows, scoreRows] = await Promise.all([
    sql.query(
      `select i.job_id, t.author,
              count(distinct p.model_id)::int as models,
              string_agg(distinct m.name, ', ') as names
         from transcriber.plan_items i
         join transcriber.plans  p on p.id = i.plan_id
         join transcriber.models m on m.id = p.model_id
         left join transcriber.transcripts t on t.job_id = i.job_id
        where p.week_of = $1::date and m.status = 'active'
        group by i.job_id, t.author
       having count(distinct p.model_id) > 1
        order by count(distinct p.model_id) desc, t.author nulls last`,
      [weekOf],
    ),
    sql.query(
      `select
         (select count(*) from transcriber.jobs where status = 'done' and archived_at is null)::int as held,
         (select count(*) from transcriber.jobs j
           where j.status = 'done' and j.archived_at is null
             and not exists (select 1 from transcriber.plan_items i where i.job_id = j.id)
         )::int as unused,
         (select count(*) from transcriber.jobs j
           where j.status = 'done' and j.archived_at is null
             and not exists (select 1 from transcriber.tags t
                              where t.job_id = j.id and t.axis = 'format')
         )::int as untagged,
         (select count(*) from transcriber.jobs where status = 'failed')::int as failed,
         (select count(*) from transcriber.models
           where status = 'active' and cardinality(formats) = 0)::int as unprofiled`,
    ),
    sql.query(
      `select count(distinct p.id)::int as sent,
              count(distinct p.id) filter (
                where (p.sent_at at time zone m.timezone)::date <= p.week_of
              )::int as sent_on_time,
              count(i.id)::int as items,
              count(i.id) filter (where i.accepted_at is not null)::int as accepted,
              count(i.id) filter (where i.declined_at is not null)::int as declined,
              count(i.id) filter (where i.filmed_at  is not null)::int as filmed,
              count(i.id) filter (where i.posted_at  is not null)::int as posted
         from transcriber.plans p
         join transcriber.models m on m.id = p.model_id
         left join transcriber.plan_items i on i.plan_id = p.id
        where p.status = 'sent'
          and p.week_of > $1::date - interval '${SCORE_WEEKS} weeks'
          and p.week_of <= $1::date`,
      [weekOf],
    ),
  ])
  const [health] = healthRows
  const [score] = scoreRows

  return {
    weekOf,
    rows: sweep,
    ourSide,
    slipped,
    silent,
    neverOpened,
    openedNoAnswer,
    overdue,
    questions,
    collisions: collisions.map((row) => ({
      job_id: String(row.job_id),
      author: (row.author as string | null) ?? null,
      models: Number(row.models ?? 0),
      names: String(row.names ?? ''),
    })),
    library: {
      held: Number(health?.held ?? 0),
      unused: Number(health?.unused ?? 0),
      untagged: Number(health?.untagged ?? 0),
      failed: Number(health?.failed ?? 0),
      unprofiled: Number(health?.unprofiled ?? 0),
    },
    score: {
      weeks: SCORE_WEEKS,
      sent: Number(score?.sent ?? 0),
      sentOnTime: Number(score?.sent_on_time ?? 0),
      items: Number(score?.items ?? 0),
      accepted: Number(score?.accepted ?? 0),
      declined: Number(score?.declined ?? 0),
      filmed: Number(score?.filmed ?? 0),
      posted: Number(score?.posted ?? 0),
    },
  }
}
