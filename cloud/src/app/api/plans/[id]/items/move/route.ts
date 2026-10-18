import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { isPastWeek } from '@/lib/carry'
import { sql } from '@/lib/db'
import { addDays, currentWeekOf, mondayOf } from '@/lib/dates'
import { newId } from '@/lib/models'

type Params = { params: Promise<{ id: string }> }

/** The last day of the week the plan belongs to. Same as creating one. */
const DUE_OFFSET_DAYS = 6

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * Move one card to another week — `{ item, week_of }`.
 *
 * Carrying moves a whole week, and only once it has passed; before this, a
 * single card could only be reordered or deleted where it stood. The card is
 * re-pointed, never copied, so her thread, accept, filmed mark and video come
 * with it. It goes to the end of the target week, which is created if it does
 * not exist yet.
 *
 * `carried_from` is set only when the card leaves a week she was sent — that
 * is a video she had and did not film, which is what standing counts as
 * backlog. Moving a draft card around is planning, not a miss.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const itemId = typeof body.item === 'string' ? body.item : ''
  if (!itemId || !isDate(body.week_of)) {
    return NextResponse.json({ error: 'item and week_of are required' }, { status: 400 })
  }

  const [source] = await sql.query(
    `select p.id, p.model_id, p.status, to_char(p.week_of, 'YYYY-MM-DD') as week_of, m.timezone,
            i.job_id
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
       join transcriber.plan_items i on i.plan_id = p.id and i.id = $2
      where p.id = $1`,
    [id, itemId],
  )
  if (!source) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const weekOf = mondayOf(body.week_of)
  if (isPastWeek(weekOf, currentWeekOf(String(source.timezone)))) {
    return NextResponse.json({ error: 'That week has passed. Pick this week or a later one.' }, { status: 409 })
  }
  if (weekOf === source.week_of) {
    return NextResponse.json({ error: 'It is already on that week.' }, { status: 409 })
  }

  const [target] = await sql.query(
    `insert into transcriber.plans (id, model_id, week_of, due_date)
     values ($1, $2, $3::date, $4::date)
     on conflict (model_id, week_of) do update set updated_at = now()
     returning id, to_char(week_of, 'YYYY-MM-DD') as week_of`,
    [newId(), source.model_id, weekOf, addDays(weekOf, DUE_OFFSET_DAYS)],
  )

  const [twin] = await sql.query(
    `select 1 from transcriber.plan_items where plan_id = $1 and job_id = $2`,
    [target.id, source.job_id],
  )
  if (twin) return NextResponse.json({ error: 'That video is already on that week.' }, { status: 409 })

  const carried = String(source.status) === 'sent' && source.week_of < weekOf
  const [moved] = await sql.query(
    `update transcriber.plan_items
        set plan_id = $2,
            position = (select coalesce(max(position) + 1, 0) from transcriber.plan_items where plan_id = $2),
            carried_from = case when $4 then coalesce(carried_from, $5::date) else carried_from end
      where id = $1 and plan_id = $3
      returning id`,
    [itemId, target.id, id, carried, source.week_of],
  )
  if (!moved) return NextResponse.json({ error: 'It was already moved.' }, { status: 409 })

  return NextResponse.json({ plan: { id: String(target.id), week_of: String(target.week_of) } })
}
