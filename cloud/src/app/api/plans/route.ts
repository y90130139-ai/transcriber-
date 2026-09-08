import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { addDays, currentWeekOf } from '@/lib/dates'
import { alsoOn } from '@/lib/match'
import { appendItems, newId, readWeekOf } from '@/lib/models'

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** The last day of the week the plan belongs to. */
const DUE_OFFSET_DAYS = 6

const PLAN_COLUMNS = `
  id, model_id, to_char(week_of, 'YYYY-MM-DD') as week_of,
  to_char(due_date, 'YYYY-MM-DD') as due_date, title, intro, status, sent_at
`

/** As many as the bulk add itself will take. */
const MAX_ASKED = 60

/**
 * Who else is already carrying these reels.
 *
 * Answered before anything is committed, so a shortlist of six can say which of
 * them another creator already has. `match.ts` excludes what is assigned, but
 * only per model — nothing else in the console can see across the roster.
 *
 * Read-only. It warns; the caller still decides.
 */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return unauthorized()

  const url = new URL(request.url)
  const jobIds = (url.searchParams.get('jobs') ?? '')
    .split(',')
    .map((jobId) => jobId.trim())
    .filter(Boolean)
    .slice(0, MAX_ASKED)
  const modelId = url.searchParams.get('model') ?? ''
  if (jobIds.length === 0) return NextResponse.json({ collisions: {} })

  const rows = await sql.query(
    `select j.id as job_id, ${alsoOn('j.id', '$2')} as also_on
       from transcriber.jobs j
      where j.id = any($1::text[])`,
    [jobIds, modelId],
  )

  return NextResponse.json({
    collisions: Object.fromEntries(
      rows
        .filter((row) => Array.isArray(row.also_on) && row.also_on.length > 0)
        .map((row) => [String(row.job_id), row.also_on]),
    ),
  })
}

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
