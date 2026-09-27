import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { describeReel, type Frame } from '@/lib/describe'

const MAX_LIMIT = 200
/** A keyframe at 540px is ~40 KB; four of them, base64, stay well under this. */
const MAX_FRAME = 400_000

/**
 * One line per shot, from the vision model (`lib/describe.ts`).
 *
 * `{ need: true, limit? }` — measured reels not yet described, live weeks
 * first. `{ job_id, frames: [{ no, image }] }` — describe one; `image` is a
 * `data:image/jpeg;base64,` keyframe the Mac cut from its own copy.
 *
 * A refused call answers 429 with Cloudflare's reason, so the nightly job
 * stops at the first sign the allowance is gone (same rule as the captions).
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  if (body.need === true) {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), MAX_LIMIT)
    const items = await sql.query(
      `select t.job_id, t.folder, jsonb_array_length(t.shots->'shots') as shots
         from transcriber.transcripts t
        where t.shots is not null and t.folder is not null
          and coalesce((t.shots->>'described')::boolean, false) = false
        order by exists (
                   select 1 from transcriber.plan_items i
                     join transcriber.plans p on p.id = i.plan_id
                    where i.job_id = t.job_id and i.declined_at is null
                      and p.week_of >= current_date - 7
                 ) desc,
                 t.shots_at desc
        limit $1`,
      [limit],
    )
    return NextResponse.json({ items })
  }

  const jobId = typeof body.job_id === 'string' ? body.job_id : ''
  const frames: Frame[] = Array.isArray(body.frames)
    ? body.frames
        .filter((f: unknown): f is Frame => Boolean(f) && typeof (f as Frame).image === 'string' && (f as Frame).image.length < MAX_FRAME)
        .map((f: Frame) => ({ no: Number(f.no), image: f.image }))
    : []
  if (!jobId || !frames.length) return NextResponse.json({ error: 'job_id and frames required' }, { status: 400 })
  try {
    const result = await describeReel(jobId, frames)
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (error) {
    const reason = String(error).slice(0, 300)
    return NextResponse.json({ ok: false, reason }, { status: /Workers AI 429/.test(reason) ? 429 : 502 })
  }
}
