import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { SCORING_COLUMNS, SCORING_CTE, SCORING_JOIN } from '@/lib/hot'
import { linksFor, mediaBase } from '@/lib/media'
import { trashKeys } from '@/lib/models'
import { tagsFor } from '@/lib/tagging'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const [item] = await sql.query(
    `with ${SCORING_CTE}
     select j.id, j.kind, j.source, j.label, j.status, j.stage, j.error, j.created_at,
            t.*, ${SCORING_COLUMNS}
       from transcriber.jobs j
       left join transcriber.transcripts t on t.job_id = j.id
       ${SCORING_JOIN}
      where j.id = $1`,
    [id],
  )
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // The poster is served as an image, not inlined; a data URL that size has no
  // business travelling inside a JSON body the grid also polls.
  delete item.thumbnail

  const base = item.folder ? await mediaBase() : null
  return NextResponse.json({
    item,
    tags: await tagsFor(id),
    media: base && item.folder ? linksFor(base, String(item.folder)) : null,
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  // Plan items cascade away with the job, so their R2 objects have to be handed
  // to the Mac before the rows that name them disappear.
  const onPlans = await sql.query(
    `select r2_key from transcriber.plan_items where job_id = $1 and r2_key is not null`,
    [id],
  )
  await trashKeys(onPlans.map((row) => row.r2_key as string))

  await sql.query(`delete from transcriber.jobs where id = $1`, [id])
  return NextResponse.json({ ok: true })
}

/** Say whether anyone talks in this, overruling what the pass heard.
 *
 * Every video now gets a speech pass on fetch — it costs about a second — so
 * this is normally a correction, not an instruction, and it does not re-run
 * anything. Two cases still put the job back in the queue: a failed one, where
 * the flip is a correction to the attempt that failed, and a legacy row that
 * was fetched before the pass was unconditional and so has never been listened
 * to at all. `has_speech is null` is exactly that "never listened" state; it is
 * not the same statement as false.
 */
export async function PATCH(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  if (typeof body.speech !== 'boolean') {
    return NextResponse.json({ error: 'speech must be a boolean' }, { status: 400 })
  }

  // Recorded even when there is no transcript row yet, so a call made while the
  // Mac is still fetching is not silently dropped.
  await sql.query(
    `insert into transcriber.transcripts (job_id, speech_override)
     values ($1, $2::boolean)
     on conflict (job_id) do update set speech_override = excluded.speech_override`,
    [id, body.speech],
  )

  // A job the Mac is holding right now is left alone — it has already been
  // handed its orders, so the answer is recorded and the run finishes as it
  // started.
  const [row] = await sql.query(
    `update transcriber.jobs j
        set transcribe = case when $2::boolean then true else j.transcribe end,
            status = case
              when j.status = 'failed' then 'queued'
              when $2::boolean
               and j.status = 'done'
               and (select t.has_speech from transcriber.transcripts t
                     where t.job_id = j.id) is null
              then 'queued' else j.status end,
            stage = null,
            error = case when j.status = 'failed' then null else j.error end,
            attempts = case when j.status = 'failed' then 0 else j.attempts end,
            claimed_at = case when j.status = 'running' then j.claimed_at else null end,
            updated_at = now()
      where j.id = $1
      returning j.id, j.status`,
    [id, body.speech],
  )
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, ...row, speech: body.speech })
}

/** Re-queue a failed job so a transient platform error can be retried in place. */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  await sql.query(
    `update transcriber.jobs
        set status = 'queued', stage = null, error = null, claimed_at = null, updated_at = now()
      where id = $1`,
    [id],
  )
  return NextResponse.json({ ok: true })
}
