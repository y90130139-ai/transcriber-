import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 50
/** A shot list bigger than this is not a shot list. */
const MAX_BYTES = 40_000

/**
 * The picture of each reference, shot by shot, from the Mac (`./bin/look`).
 *
 * `{ need: true, limit? }` — which library videos still have no shot list,
 * those on a model's live week first (they are the ones a card is being read
 * for today), then the rest, newest first.
 * `{ job_id, shots }` — store one.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  if (body.need === true) {
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const onlyJobs = Array.isArray(body.jobs) ? body.jobs.map(String).slice(0, MAX_LIMIT) : null
    const items = await sql.query(
      `select t.job_id, t.folder
         from transcriber.transcripts t
         join transcriber.jobs j on j.id = t.job_id
        where t.folder is not null and j.status = 'done'
          and ($2::text[] is null or t.job_id = any($2::text[]))
          and (t.shots is null or ($2::text[] is not null and $3::boolean))
        order by exists (
                   select 1 from transcriber.plan_items i
                     join transcriber.plans p on p.id = i.plan_id
                    where i.job_id = t.job_id and i.declined_at is null
                      and p.week_of >= current_date - 7
                 ) desc,
                 t.transcribed_at desc nulls last
        limit $1`,
      [limit, onlyJobs, body.again === true],
    )
    return NextResponse.json({ items })
  }

  const jobId = typeof body.job_id === 'string' ? body.job_id : ''
  const shots = body.shots
  if (!jobId || !shots || typeof shots !== 'object' || !Array.isArray(shots.shots)) {
    return NextResponse.json({ error: 'job_id and shots required' }, { status: 400 })
  }
  const text = JSON.stringify(shots)
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'too big' }, { status: 413 })
  const [row] = await sql.query(
    `update transcriber.transcripts set shots = $2::jsonb, shots_at = now() where job_id = $1 returning job_id`,
    [jobId, text],
  )
  return row ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not found' }, { status: 404 })
}
