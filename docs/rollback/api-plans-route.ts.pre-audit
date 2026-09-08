import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { addDays, currentWeekOf } from '@/lib/dates'
import { appendItems, newId, readWeekOf } from '@/lib/models'

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** The last day of the week the plan belongs to. */
const DUE_OFFSET_DAYS = 6

const PLAN_COLUMNS = `
  id, model_id, to_char(week_of, 'YYYY-MM-DD') as week_of,
  to_char(due_date, 'YYYY-MM-DD') as due_date, title, intro, status, sent_at
`

/**
 * Create-or-get a model's plan for one week, and optionally put a library item
 * on it in the same call — which is what the assign control in the item view
 * needs, and what keeps assigning to one tap.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const modelId = typeof body.model_id === 'string' ? body.model_id : ''
  if (!modelId) return NextResponse.json({ error: 'model_id is required' }, { status: 400 })

  const [model] = await sql.query(
    `select id, timezone from transcriber.models where id = $1`,
    [modelId],
  )
  if (!model) return NextResponse.json({ error: 'no such model' }, { status: 404 })

  const weekOf = readWeekOf(body.week_of, currentWeekOf(String(model.timezone)))

  const [plan] = await sql.query(
    `insert into transcriber.plans (id, model_id, week_of, due_date)
     values ($1, $2, $3::date, $4::date)
     on conflict (model_id, week_of) do update set updated_at = now()
     returning ${PLAN_COLUMNS}`,
    [newId(), modelId, weekOf, addDays(weekOf, DUE_OFFSET_DAYS)],
  )

  const jobId = typeof body.job_id === 'string' ? body.job_id : null
  if (!jobId) return NextResponse.json({ plan, added: 0 })

  const added = await appendItems(String(plan.id), modelId, [jobId])
  return NextResponse.json({ plan, added })
}
