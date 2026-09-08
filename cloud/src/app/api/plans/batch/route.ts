import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { previewBatch } from '@/lib/batch'
import { addDays, currentWeekOf } from '@/lib/dates'
import { sql } from '@/lib/db'
import { appendItems, newId, readWeekOf } from '@/lib/models'

export const maxDuration = 60

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** The last day of the week the plan belongs to — the same offset a week
 *  opened by hand gets. */
const DUE_OFFSET_DAYS = 6

/** A ceiling on one pass, so a bad request cannot ask for the whole library. */
const MAX_MODELS = 60
const MAX_PER_MODEL = 60

/** What one pass would draft. Writes nothing. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return unauthorized()
  const asked = new URL(request.url).searchParams.get('week')
  return NextResponse.json(await previewBatch(readWeekOf(asked, currentWeekOf())))
}

/**
 * Write the drafts that were just previewed.
 *
 * The picks come back from the client rather than being recomputed, so what
 * gets written is exactly what was looked at. Recomputing here would let the
 * two answers drift between the preview and the tap — a suggestion is ranked
 * partly on engagement, and engagement moves.
 *
 * Every week this opens is a draft. Nothing here can send anything, and there
 * is deliberately no parameter that would let it.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const weekOf = readWeekOf(body.week_of, currentWeekOf())
  const offered = Array.isArray(body.picks) ? body.picks.slice(0, MAX_MODELS) : []

  let opened = 0
  let added = 0
  const built: { model_id: string; plan_id: string; added: number }[] = []

  for (const entry of offered) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const modelId = typeof row.model_id === 'string' ? row.model_id : ''
    const jobIds = Array.isArray(row.job_ids)
      ? row.job_ids
          .filter((jobId: unknown): jobId is string => typeof jobId === 'string' && jobId.length > 0)
          .slice(0, MAX_PER_MODEL)
      : []
    if (!modelId || jobIds.length === 0) continue

    // Active only, and proven to exist, before anything is created for it.
    const [model] = await sql.query(
      `select id from transcriber.models where id = $1 and status = 'active'`,
      [modelId],
    )
    if (!model) continue

    // Create-or-get, exactly as opening a week by hand does. `do update` keeps
    // an existing week — a batch tops a week up, it never replaces one.
    const [plan] = await sql.query(
      `insert into transcriber.plans (id, model_id, week_of, due_date)
       values ($1, $2, $3::date, $4::date)
       on conflict (model_id, week_of) do update set updated_at = now()
       returning id, (xmax = 0) as created`,
      [newId(), modelId, weekOf, addDays(weekOf, DUE_OFFSET_DAYS)],
    )
    if (plan.created) opened += 1

    // Drafts the brief on the way in, and the unique index makes a reel that
    // is already on her week a no-op rather than a second card.
    const wrote = await appendItems(String(plan.id), modelId, jobIds)
    added += wrote
    built.push({ model_id: modelId, plan_id: String(plan.id), added: wrote })
  }

  return NextResponse.json({ weekOf, opened, added, built })
}
