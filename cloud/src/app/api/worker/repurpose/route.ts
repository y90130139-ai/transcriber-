import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { trashKeys } from '@/lib/models'

/**
 * The Mac reports a finished repurpose render (2026-10-18).
 *
 * `ready` records where the fresh file lives in R2 and how big it is — the row
 * is the ledger the Reels tab presigns from. `failed` keeps the Mac's own
 * words, because "why is there no file" is the one question anyone will have.
 * The attempt count already lives on the row; nothing here retries on its own.
 *
 * A report for a row that is already gone (someone unmarked the reel while
 * the render was in flight) still has an uploaded file behind it: the key
 * goes on the trash list so it is reclaimed rather than orphaned, since the
 * `repurposed/` prefix is outside the bucket reconcile's view.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  const status = body.status === 'ready' ? 'ready' : body.status === 'failed' ? 'failed' : ''
  if (!id || !status) return NextResponse.json({ error: 'id and status are required' }, { status: 400 })

  if (status === 'ready') {
    const key = typeof body.key === 'string' && body.key ? body.key : null
    if (!key) return NextResponse.json({ error: 'a ready render needs its key' }, { status: 400 })
    const bytes = Number(body.bytes)
    const rows = await sql.query(
      `update transcriber.repurposes
          set status = 'ready', output_key = $2, output_bytes = $3,
              rendered_at = now(), error = null
        where post_id = $1
        returning post_id`,
      [id, key, Number.isFinite(bytes) ? bytes : null],
    )
    if (rows.length === 0) await trashKeys([key])
    return NextResponse.json({ ok: true, kept: rows.length > 0 })
  }

  const error = typeof body.error === 'string' && body.error.trim()
    ? body.error.trim().slice(0, 900)
    : 'the render failed with no reason given'
  await sql.query(
    `update transcriber.repurposes set status = 'failed', error = $2 where post_id = $1`,
    [id, error],
  )
  return NextResponse.json({ ok: true })
}
