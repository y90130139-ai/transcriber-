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
            ${preview('t.plain', 180, 't.on_screen_text')} as preview, ${SCORING_COLUMNS}
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

  // `apply` carries the approved persona down onto everything this creator has
  // already posted. Without it the persona only reaches what they post next,
  // via the auto-tagger — which is why 119 items carry a format tag and only 44
  // carry a persona, and why the backfill exists at all.
  //
  // Opt-in, so the sheet's own Save keeps doing exactly what it always did.
  // Marked `human` because a person approved it, which also means a later
  // `/api/retag` run cannot overwrite it — that pass only replaces its own
  // guesses.
  if (body.apply !== true) return NextResponse.json({ creator: saved })

  // Replaced rather than added to: persona is a property of the creator, so
  // approving a correction has to be able to remove what the guess got wrong.
  await sql.query(
    `delete from transcriber.tags g
      using transcriber.transcripts t
      where t.job_id = g.job_id and t.author = $1 and g.axis = 'persona'`,
    [who],
  )

  let applied = 0
  if (persona.length > 0) {
    const written = await sql.query(
      `insert into transcriber.tags (job_id, axis, tag, origin, score)
       select t.job_id, 'persona', chosen.tag, 'human', 1
         from transcriber.transcripts t, unnest($2::text[]) as chosen(tag)
        where t.author = $1
       on conflict (job_id, axis, tag) do nothing
       returning job_id`,
      [who, persona],
    )
    applied = written.length
  }

  const [counted] = await sql.query(
    `select count(*)::int as posts from transcriber.transcripts where author = $1`,
    [who],
  )

  return NextResponse.json({
    creator: saved,
    applied,
    posts: Number(counted?.posts ?? 0),
  })
}
