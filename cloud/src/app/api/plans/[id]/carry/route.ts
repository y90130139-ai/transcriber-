import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { carryTarget, isPastWeek, type WeekRef } from '@/lib/carry'
import { sql } from '@/lib/db'
import { addDays, currentWeekOf } from '@/lib/dates'
import { newId } from '@/lib/models'

type Params = { params: Promise<{ id: string }> }

/** The last day of the week the plan belongs to. Same as creating one. */
const DUE_OFFSET_DAYS = 6

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/**
 * Move every video on a past week onto her current week, then drop the empty
 * week. See `lib/carry.ts` for which week that is.
 *
 * The videos are re-pointed, not copied, so nothing she has done on them is
 * lost. They go to the top of the target week: they were due first. The
 * target ends up sent if either week was, and opened if she opened either —
 * otherwise moving a week she is halfway through would blank her link.
 *
 * A video already on the target week stays behind rather than being doubled,
 * and the source week is only deleted once nothing is left on it. No R2
 * object is trashed: every one of them moved with its item.
 */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const [source] = await sql.query(
    `select p.id, p.model_id, to_char(p.week_of, 'YYYY-MM-DD') as week_of, m.timezone
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
      where p.id = $1`,
    [id],
  )
  if (!source) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const thisWeek = currentWeekOf(String(source.timezone))
  if (!isPastWeek(String(source.week_of), thisWeek)) {
    return NextResponse.json({ error: 'This week has not passed yet.' }, { status: 409 })
  }

  const weeks = (await sql.query(
    `select id, to_char(week_of, 'YYYY-MM-DD') as week_of, status
       from transcriber.plans where model_id = $1`,
    [source.model_id],
  )) as WeekRef[]

  const target = carryTarget(weeks, id, thisWeek)
  let targetId: string
  if (target.kind === 'existing') {
    targetId = target.id
  } else {
    const [created] = await sql.query(
      `insert into transcriber.plans (id, model_id, week_of, due_date)
       values ($1, $2, $3::date, $4::date)
       on conflict (model_id, week_of) do update set updated_at = now()
       returning id`,
      [newId(), source.model_id, target.week_of, addDays(target.week_of, DUE_OFFSET_DAYS)],
    )
    targetId = String(created.id)
  }

  // The videos that can move: everything on the source that is not already on
  // the target. Written once and used by each statement, all inside one
  // transaction so a half-moved week cannot exist.
  const movable = `
    select s.id, s.position from transcriber.plan_items s
     where s.plan_id = $1
       and s.job_id not in (select job_id from transcriber.plan_items where plan_id = $2)`

  // Nothing that can move means nothing to do. Without this, a past week whose
  // every video is already on the target would still push its sent and opened
  // state onto her live week — and could be clicked again and again.
  const [{ n: movableCount }] = await sql.query(
    `select count(*)::int as n from (${movable}) m`, [id, targetId],
  )
  if (movableCount === 0) {
    return NextResponse.json(
      { error: 'Every video on this week is already on the week it would move to.' },
      { status: 409 },
    )
  }

  const [, moved, merged, deleted] = await sql.transaction([
    // Make room at the top of the target for what is arriving.
    sql.query(
      `update transcriber.plan_items
          set position = position + (select coalesce(max(position) + 1, 0) from (${movable}) m)
        where plan_id = $2`,
      [id, targetId],
    ),
    sql.query(
      // `carried_from` keeps the first week it was ever put on, so a card
      // carried twice still says where it started.
      `update transcriber.plan_items
          set plan_id = $2,
              carried_from = coalesce(carried_from, (select week_of from transcriber.plans where id = $1))
        where id in (select id from (${movable}) m)
        returning id`,
      [id, targetId],
    ),
    sql.query(
      `update transcriber.plans t
          set status    = case when t.status = 'sent' or s.status = 'sent' then 'sent' else 'draft' end,
              -- Sent and opened travel as a pair, from one week, never mixed:
              -- heat reads the gap between them, and the old week's send date
              -- beside this week's open would make a prompt creator look slow.
              -- The target's own pair wins once it has been sent.
              sent_at   = case when t.status = 'sent' then t.sent_at
                               when s.status = 'sent' then s.sent_at end,
              opened_at = case when t.status = 'sent' then t.opened_at
                               when s.status = 'sent' then s.opened_at end,
              title     = coalesce(t.title, s.title),
              intro     = coalesce(t.intro, s.intro),
              updated_at = now()
         from transcriber.plans s
        where t.id = $2 and s.id = $1
        returning t.id, to_char(t.week_of, 'YYYY-MM-DD') as week_of, t.status`,
      [id, targetId],
    ),
    sql.query(
      `delete from transcriber.plans p
        where p.id = $1
          and not exists (select 1 from transcriber.plan_items i where i.plan_id = p.id)
        returning p.id`,
      [id],
    ),
  ])

  const plan = merged[0]
  // The source was gone by the time this transaction ran: a second tab or a
  // retry got there first. The move happened — just not this request's.
  if (!plan) {
    return NextResponse.json({ error: 'This week was already moved.' }, { status: 409 })
  }
  const left = deleted.length === 0
    ? Number((await sql.query(
        `select count(*)::int as n from transcriber.plan_items where plan_id = $1`, [id],
      ))[0]?.n ?? 0)
    : 0

  return NextResponse.json({ plan, moved: moved.length, left, deleted: deleted.length > 0 })
}
