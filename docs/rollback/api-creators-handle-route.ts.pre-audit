import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { preview } from '@/lib/sql'
import { SCORING_COLUMNS, SCORING_CTE, SCORING_JOIN } from '@/lib/hot'
import { isValidTag } from '@/lib/taxonomy'

type Params = { params: Promise<{ handle: string }> }

/** One creator: their persona, their normal, and what beat it. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { handle } = await params
  const who = decodeURIComponent(handle)

  const [profile] = await sql.query(
    `select c.handle, c.display_name, c.persona, c.note
       from transcriber.creators c where c.handle = $1`,
    [who],
  )

  const posts = await sql.query(
    `with ${SCORING_CTE}
     select j.id, t.title, t.upload_date, t.duration_sec, t.like_count, t.comment_count,
            t.word_count, t.webpage_url, t.folder, (t.thumbnail is not null) as has_thumb,
            ${preview('t.plain', 180)} as preview, ${SCORING_COLUMNS}
       from transcriber.transcripts t
       join transcriber.jobs j on j.id = t.job_id
       ${SCORING_JOIN}
      where t.author = $1
      order by outperformance desc nulls last, t.upload_date desc`,
    [who],
  )

  // What this creator actually makes, counted across their whole shelf.
  const tally = await sql.query(
    `select g.axis, g.tag, count(*)::int as n
       from transcriber.tags g
       join transcriber.transcripts t on t.job_id = g.job_id
      where t.author = $1
      group by g.axis, g.tag
      order by n desc`,
    [who],
  )

  return NextResponse.json({
    creator: profile ?? { handle: who, display_name: null, persona: [], note: null },
    posts,
    tally,
  })
}

/** Set the creator's persona. It then carries to everything they post next. */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { handle } = await params
  const who = decodeURIComponent(handle)
  const body = await request.json().catch(() => ({}))

  const offered: string[] = Array.isArray(body.persona)
    ? body.persona.filter((tag: unknown): tag is string => typeof tag === 'string')
    : []
  const persona = [...new Set(offered)].filter((tag) => isValidTag('persona', tag))
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null

  const [saved] = await sql.query(
    `insert into transcriber.creators (handle, persona, note)
     values ($1, $2::text[], $3)
     on conflict (handle) do update
        set persona = excluded.persona, note = excluded.note, updated_at = now()
     returning handle, display_name, persona, note`,
    [who, persona, note],
  )
  return NextResponse.json({ creator: saved })
}
