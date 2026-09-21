import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { TRIAL_STAGE_PER_DAY, editorQueueFor } from '@/lib/editor'

type Params = { params: Promise<{ id: string }> }

/** Her edit-reskin and trial-reel queue, topped up from her current winners. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const queue = await editorQueueFor(id)
  if (!queue) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(queue)
}

/**
 *   done   { task_id, done: boolean } — tick a task off, or untick it
 *   stage  { stage: 1 | 2 | 3 } — the trial-reel rollout, advanced by hand
 *          when a stage runs smoothly, which is the manual's own test
 */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (body.action === 'done' && typeof body.task_id === 'string') {
    await sql.query(
      `update transcriber.editor_tasks set done_at = case when $3 then now() else null end
        where id = $1 and model_id = $2`,
      [body.task_id, id, body.done !== false],
    )
    return NextResponse.json({ ok: true })
  }
  const stage = Number(body.stage)
  if (body.action === 'stage' && Number.isInteger(stage) && stage >= 1 && stage <= TRIAL_STAGE_PER_DAY.length) {
    await sql.query(`update transcriber.models set trial_stage = $2 where id = $1`, [id, stage])
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
