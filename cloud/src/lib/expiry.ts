/**
 * The library keeps 90 days (Geno, 2026-09-27): a reel older than that is not
 * worth handing anyone, so it leaves. Five days out it is tagged Expiring, the
 * nudge to get it onto someone's week while it still counts.
 *
 *   Age      from the day it went up on Instagram (`upload_date`). A row with
 *            no post date ages from the day it entered the library.
 *   Leaves   archived, never deleted — hidden from the library, suggestions
 *            and the planner; transcript, tags and past plan cards untouched;
 *            restorable from the Archived shelf.
 *   Exempt   a model's own reels (Recreate's material), and any reel on a card
 *            still open: not filmed, not declined, its week not over. It
 *            leaves at the first daily pass (10am ET) after it closes.
 *
 * SQL fragments take the aliases they are dropped into, so every query reads
 * the rule the same way.
 */
import { sql } from './db'

export const EXPIRE_DAYS = 90
export const WARN_DAYS = 5

/** The day the reel went up, or the day it was added when that is unknown. */
export const postedOn = (j: string, t: string) => `coalesce(
  case when ${t}.upload_date ~ '^\\d{4}-\\d{2}-\\d{2}$' then ${t}.upload_date::date end,
  (${j}.created_at at time zone 'America/New_York')::date)`

/** Days left before it leaves (0 = today, negative = past due). */
export const daysLeft = (j: string, t: string) =>
  `(${EXPIRE_DAYS} - (current_date - ${postedOn(j, t)}))`

/** Every Instagram handle a model has: her handle and each Instagram social. */
const MODEL_HANDLES = `(
  select lower(ltrim(m.handle, '@')) from transcriber.models m where coalesce(m.handle, '') <> ''
  union
  select lower(ltrim(s->>'handle', '@'))
    from transcriber.models m, jsonb_array_elements(case when jsonb_typeof(m.socials) = 'array' then m.socials else '[]'::jsonb end) s
   where s->>'platform' ilike 'instagram%')`

/** One of our models' own reels — never expires. */
export const isHers = (j: string, t: string) =>
  `(${j}.batch_id like 'hers-%' or lower(coalesce(${t}.author, '')) in ${MODEL_HANDLES})`

/** On a card that is still open: not filmed, not declined, week not over. */
export const onOpenCard = (j: string) => `exists (
  select 1 from transcriber.plan_items oi
    join transcriber.plans op on op.id = oi.plan_id
   where oi.job_id = ${j}.id and oi.filmed_at is null and oi.declined_at is null
     and op.week_of + 7 > current_date)`

/**
 * The daily pass (the 10am ET cron): archive every reel past 90 days that is not hers and not
 * on an open card. Returns how many left.
 */
export async function archiveExpired(): Promise<number> {
  const rows = await sql.query(
    `update transcriber.jobs j
        set archived_at = now(), archived_reason = 'expired'
       from transcriber.transcripts t
      where t.job_id = j.id and j.status = 'done' and j.archived_at is null
        and ${daysLeft('j', 't')} <= 0
        and not ${isHers('j', 't')}
        and not ${onOpenCard('j')}
      returning j.id`,
  )
  return rows.length
}
