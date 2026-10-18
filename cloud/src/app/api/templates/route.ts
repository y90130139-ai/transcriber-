import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { findGerman } from '@/lib/german'
import { newId } from '@/lib/models'
import { isValidTag } from '@/lib/taxonomy'

/**
 * Card templates (Geno, 2026-10-07): the team's own reusable blanks for the
 * plan editor — a label, a format, the directions. "Anytime we add them, it
 * just stays there, and we could edit them if we misspell it by accident."
 *
 * German templates carry more (2026-10-16): the playbook entry they are
 * (variant) and the reference video that rides Version 1 (job_id) — saved
 * from the Format reel lane, restored whole when the template is picked.
 */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  // has_thumb (2026-10-18): the card shows the attached video's frame as a
  // cover; the flag gates the image so a video-less template never requests
  // a thumbnail that cannot exist.
  const rows = await sql.query(
    `select p.id, p.label, p.format, p.body, p.variant, p.job_id,
            (t.thumbnail is not null) as has_thumb
       from transcriber.plan_templates p
       left join transcriber.transcripts t on t.job_id = p.job_id
      order by lower(p.label)`,
  )
  return NextResponse.json({ templates: rows })
}

async function readFields(body: Record<string, unknown>) {
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : ''
  const askedFormat = typeof body.format === 'string' ? body.format : ''
  const format = askedFormat && (
    isValidTag('format', askedFormat) ||
    (await sql.query(`select 1 from transcriber.custom_formats where id = $1`, [askedFormat])).length > 0
  ) ? askedFormat : null
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 4000) : null
  // Only a German template keeps a playbook entry and a video: anything else
  // lands null here, so no other lane can pick up a stray variant or job.
  const askedVariant = typeof body.variant === 'string' ? body.variant : ''
  const variant = format === 'german' && askedVariant && findGerman(askedVariant) ? askedVariant : null
  const askedJob = typeof body.job_id === 'string' ? body.job_id.trim() : ''
  const jobId = format === 'german' && /^[A-Za-z0-9_-]{6,64}$/.test(askedJob) ? askedJob : null
  return { label, format, text, variant, jobId }
}

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const body = await request.json().catch(() => ({}))
  const { label, format, text, variant, jobId } = await readFields(body)
  if (!label) return NextResponse.json({ error: 'give the template a label' }, { status: 400 })
  const [row] = await sql.query(
    `insert into transcriber.plan_templates (id, label, format, body, variant, job_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id, label, format, body, variant, job_id`,
    [newId(), label, format, text, variant, jobId],
  )
  return NextResponse.json({ template: row })
}

export async function PATCH(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  const { label, format, text, variant, jobId } = await readFields(body)
  if (!id || !label) return NextResponse.json({ error: 'id and label are required' }, { status: 400 })
  // The Templates page edits words only; the video half stays unless the
  // caller really sent it — a blank edit must never drop the reference video.
  const sentVideo = typeof body.variant === 'string' || typeof body.job_id === 'string'
  const [row] = sentVideo
    ? await sql.query(
      `update transcriber.plan_templates
          set label = $2, format = $3, body = $4, variant = $5, job_id = $6, updated_at = now()
        where id = $1
        returning id, label, format, body, variant, job_id`,
      [id, label, format, text, variant, jobId],
    )
    : await sql.query(
      `update transcriber.plan_templates
          set label = $2, format = $3, body = $4, updated_at = now()
        where id = $1
        returning id, label, format, body, variant, job_id`,
      [id, label, format, text],
    )
  if (!row) return NextResponse.json({ error: 'no such template' }, { status: 404 })
  return NextResponse.json({ template: row })
}

export async function DELETE(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await sql.query(`delete from transcriber.plan_templates where id = $1`, [id])
  return NextResponse.json({ ok: true })
}
