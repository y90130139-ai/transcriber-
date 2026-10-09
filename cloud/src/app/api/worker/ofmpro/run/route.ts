import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * The worker reports the files it mirrored into R2, and opens/closes its run.
 *
 * One route, because both are the same thing to the cloud: a small, validated
 * statement of what the worker just did. The R2 key is written once — a row
 * that already has one keeps it (re-uploading the same object on a later run
 * must never orphan the copy the console is already streaming).
 */

const RESP = new Set(['instagram', 'tiktok', 'twitter'])

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))

  // ---------------------------------------------------------------- a run
  if (body.action === 'open' || body.action === 'close') {
    if (body.action === 'open') {
      const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(body.id) ? body.id : null
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const [row] = await sql.query(
        `insert into transcriber.ofmpro_runs (id, status) values ($1, 'running')
         on conflict (id) do nothing
         returning id, started_at`,
        [id],
      )
      return NextResponse.json({ run: row ?? { id } })
    }
    const id = typeof body.id === 'string' ? body.id : null
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const whole = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)
    const [row] = await sql.query(
      `update transcriber.ofmpro_runs
          set finished_at = now(),
              status = $2,
              window_from = coalesce($3::date, window_from),
              window_to = coalesce($4::date, window_to),
              per_platform = coalesce($5::jsonb, per_platform),
              fetched = $6, inserted = $7, updated = $8, downloaded = $9, failed = $10,
              error = $11
        where id = $1
        returning id, status`,
      [
        id,
        body.status === 'failed' ? 'failed' : 'done',
        typeof body.window_from === 'string' ? body.window_from : null,
        typeof body.window_to === 'string' ? body.window_to : null,
        body.per_platform ? JSON.stringify(body.per_platform) : null,
        whole(body.fetched), whole(body.inserted), whole(body.updated),
        whole(body.downloaded), whole(body.failed),
        typeof body.error === 'string' ? body.error.slice(0, 2000) : null,
      ],
    )
    return NextResponse.json({ run: row ?? null })
  }

  // ------------------------------------------------------- mirrored files
  const updates = Array.isArray(body.updates) ? body.updates.slice(0, 200) : []
  let marked = 0
  for (const update of updates) {
    const platform = typeof update.platform === 'string' && RESP.has(update.platform) ? update.platform : null
    const mediaId = typeof update.media_id === 'string' ? update.media_id : null
    const key = typeof update.r2_key === 'string' && update.r2_key.length > 0 ? update.r2_key.slice(0, 400) : null
    if (!platform || !mediaId || !key) continue
    const bytes = typeof update.bytes === 'number' && Number.isFinite(update.bytes) ? Math.trunc(update.bytes) : null
    const done = await sql.query(
      `update transcriber.ofmpro_media
          set r2_key = coalesce(r2_key, $3), r2_bytes = coalesce(r2_bytes, $4), downloaded_at = now()
        where platform = $1 and media_id = $2
        returning media_id`,
      [platform, mediaId, key, bytes],
    )
    if (done.length > 0) marked += 1
  }

  return NextResponse.json({ marked })
}
