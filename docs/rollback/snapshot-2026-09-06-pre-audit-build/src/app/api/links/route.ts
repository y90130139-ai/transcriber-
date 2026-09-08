import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { extractLinks, labelFor } from '@/lib/links'

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

  return NextResponse.json({
    added: rows.length,
    skipped: links.length - rows.length,
    jobs: rows,
  })
}
