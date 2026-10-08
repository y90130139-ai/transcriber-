import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { extractLinks, labelFor } from '@/lib/links'
import { appendItems } from '@/lib/models'

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => ({}))
  const text = typeof payload.text === 'string' ? payload.text : ''
  // Metadata only, for a model's own posts: they are ingested for a date and a
  // link, and whisper on forty of her reels buys nothing anyone will read.
  // Anything that does not ask still gets the pass, exactly as before.
  const transcribe = payload.transcribe !== false
  const links = extractLinks(text)
  if (links.length === 0) {
    return NextResponse.json(
      { error: 'No Instagram, TikTok or YouTube links in that paste.' },
      { status: 400 },
    )
  }

  const batchId = nanoid(10)
  // A link already in the library is skipped rather than re-transcribed, which
  // is what makes pasting an ever-growing list of saved posts cheap to re-run.
  // Everything gets a speech pass: it costs about a second against a fetch of
  // tens, so the Talking / No speech label comes from listening, not from a box.
  const rows = await sql.query(
    `insert into transcriber.jobs (id, kind, source, source_key, label, batch_id, transcribe)
     select * from unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[]
     )
     on conflict (source_key) do nothing
     returning id, label, source, status, transcribe, created_at`,
    [
      links.map(() => nanoid(12)),
      links.map(() => 'link'),
      links,
      links,
      links.map(labelFor),
      links.map(() => batchId),
      links.map(() => transcribe),
    ],
  )

  // Straight onto a week (2026-10-08): a paste in the plan editor lands its
  // videos on that plan as cards, new and already-held alike. The cards are
  // thin until the Mac fetches — her page says the video is not ready yet —
  // and every appendItems guard (declines, solo, one-card-per-reel) applies.
  let attached = 0
  if (typeof payload.plan_id === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(payload.plan_id)) {
    const [plan] = await sql.query(
      `select id, model_id from transcriber.plans where id = $1`,
      [payload.plan_id],
    )
    if (!plan) return NextResponse.json({ error: 'no such plan' }, { status: 404 })
    const held = await sql.query(
      `select id from transcriber.jobs where source_key = any($1::text[])`,
      [links],
    )
    attached = await appendItems(
      String(plan.id), String(plan.model_id),
      held.map((job) => String(job.id)),
    )
  }

  return NextResponse.json({
    added: rows.length,
    skipped: links.length - rows.length,
    attached,
    jobs: rows,
  })
}
