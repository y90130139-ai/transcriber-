import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { mediaBase } from '@/lib/media'
import { planMediaFor, r2Config } from '@/lib/r2'
import { repurposeReel } from '@/lib/repurpose'

type Params = { params: Promise<{ id: string }> }
const SHORTCODE = /^[A-Za-z0-9_-]{5,20}$/

/** Enough for a year of wins without turning her sheet into an archive. */
const SHOWN = 40

/**
 * One of her top reels onto her week as a Repurpose card — `{ post_id,
 * plan_id? }` — with the studio render queued behind it (lib/repurpose.ts).
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const code = typeof body.post_id === 'string' ? body.post_id : ''
  if (!SHORTCODE.test(code)) return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  const result = await repurposeReel(id, code, body.plan_id)
  if ('error' in result) {
    // The week refused the card, but the render was still queued — said
    // plainly, because the file is the part that takes time.
    return NextResponse.json({ error: result.error, render: result.render }, { status: result.status })
  }
  return NextResponse.json(result)
}

/**
 * Her repurposed files — the Reels tab's own section (2026-10-18).
 *
 * One row per marked reel, oldest work last. A row is `queued`/`rendering`
 * while the Mac is on it, `ready` once the fresh copy is in R2 (presigned
 * player and download ride along), `failed` with the Mac's own words. Rows
 * from before renders existed say `marked` and carry no file.
 */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  const rows = await sql.query(
    // `repurposes` is keyed by `post_id`; the DTO keeps both names so the
    // section can key on either without guessing.
    `select r.post_id as id, r.post_id, r.status, r.destination, r.note, r.created_at, r.rendered_at,
            r.error, r.recipe, r.seed, r.output_key, r.output_bytes,
            t.upload_date, t.like_count, t.comment_count,
            (t.thumbnail is not null) as has_thumb,
            j.source as source_url,
            substring(j.source from '/(?:reels?|p|tv)/([A-Za-z0-9_-]+)') as code
       from transcriber.repurposes r
       join transcriber.jobs j on j.id = r.post_id
       left join transcriber.transcripts t on t.job_id = r.post_id
      where r.model_id = $1
      order by r.created_at desc
      limit ${SHOWN}`,
    [id],
  )

  const config = r2Config()
  const repurposes = rows.map((row) => {
    const key = row.output_key ? String(row.output_key) : null
    const ready = row.status === 'ready' && key
    const media = ready && config
      ? planMediaFor(config, key, `repurposed-${row.code ? String(row.code) : String(row.post_id)}.mp4`)
      : null
    return {
      id: String(row.id),
      post_id: String(row.post_id),
      code: row.code ? String(row.code) : null,
      status: String(row.status),
      destination: String(row.destination ?? 'trial'),
      note: row.note ? String(row.note) : null,
      recipe: row.recipe ? String(row.recipe) : null,
      seed: row.seed === null || row.seed === undefined ? null : Number(row.seed),
      created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
      rendered_at: row.rendered_at ? new Date(String(row.rendered_at)).toISOString() : null,
      error: row.error ? String(row.error) : null,
      bytes: row.output_bytes === null || row.output_bytes === undefined ? null : Number(row.output_bytes),
      upload_date: row.upload_date ? String(row.upload_date) : null,
      like_count: row.like_count === null || row.like_count === undefined ? null : Number(row.like_count),
      comment_count: row.comment_count === null || row.comment_count === undefined ? null : Number(row.comment_count),
      has_thumb: Boolean(row.has_thumb),
      source_url: row.source_url ? String(row.source_url) : null,
      video: media?.video ?? null,
      download: media?.download ?? null,
    }
  })

  // Is there still work in flight? The section polls itself while there is,
  // and the Mac-side download link matters while it is not.
  const working = repurposes.some((row) => row.status === 'queued' || row.status === 'rendering')
  const mac = (await mediaBase()) !== null

  return NextResponse.json({ repurposes, working, mac })
}
