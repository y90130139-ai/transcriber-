import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { openingWeek } from '@/lib/carry'
import { addDays, currentWeekOf } from '@/lib/dates'
import { sql } from '@/lib/db'
import { newId, readWeekOf } from '@/lib/models'
import { planWeeks, readPlan } from '@/lib/plan-read'

type Params = { params: Promise<{ id: string }> }

/** The last day of the week the plan belongs to — same as POST /api/plans. */
const DUE_OFFSET_DAYS = 6

/**
 * Everything the plan editor paints first, in one round trip: her weeks, her
 * delivery folder, and the week it opens on with its cards. A model with no
 * weeks at all gets `week_of` created (create-or-get, so a double open cannot
 * make two). Before this the dialog walked model → create → model → plan, one
 * after another, and the right pane sat on "No week open" for all of it.
 */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const [[model], weeks] = await Promise.all([
    sql.query(`select id, timezone, drive_url from transcriber.models where id = $1`, [id]),
    planWeeks(id),
  ])
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const thisWeek = readWeekOf(body.week_of, currentWeekOf(String(model.timezone)))
  let plans = weeks as { id: string; week_of: string; status: 'draft' | 'sent'; items: number }[]
  let open = openingWeek(plans, thisWeek)

  if (!open) {
    await sql.query(
      `insert into transcriber.plans (id, model_id, week_of, due_date)
       values ($1, $2, $3::date, $4::date)
       on conflict (model_id, week_of) do update set updated_at = now()`,
      [newId(), id, thisWeek, addDays(thisWeek, DUE_OFFSET_DAYS)],
    )
    plans = (await planWeeks(id)) as typeof plans
    open = openingWeek(plans, thisWeek)
  }

  const read = open ? await readPlan(String(open.id)) : null
  return NextResponse.json({
    model: { drive_url: model.drive_url ?? null },
    plans,
    plan: read?.plan ?? null,
    items: read?.items ?? [],
  })
}
