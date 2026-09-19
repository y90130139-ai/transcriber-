import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { handlesIn } from '@/lib/handles'

/**
 * The watchlist itself: who the sweep reads every week.
 *
 * Two ways in. A human pastes handles or profile links — that is how a niche
 * widens past the obvious, and a comedian or a cooking account can be watched
 * for its *format* even though nothing about it is this business. And the
 * sweep proposes accounts that collaborated on a winner, which land as
 * `suggested` and cost nothing until someone says watch.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const suggested = await sql.query(
    `select c.handle, c.found_via, c.updated_at,
            (select count(*)::int from transcriber.sightings s where s.handle = c.handle) as seen
       from transcriber.creators c
      where c.watch = 'suggested'
      order by c.updated_at desc
      limit 60`,
  )
  const [counts] = await sql.query(
    `select count(*) filter (where watch = 'watching')::int as watching,
            count(*) filter (where watch = 'suggested')::int as suggested,
            count(*) filter (where watch = 'watching' and access = 'gated')::int as gated
       from transcriber.creators`,
  )
  return NextResponse.json({ suggested, counts })
}

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))

  const add = handlesIn(body.add)
  const dismiss = handlesIn(body.dismiss)

  let watching: string[] = []
  if (add.length > 0) {
    const rows = await sql.query(
      `insert into transcriber.creators (handle, display_name, watch)
       select h, h, 'watching' from unnest($1::text[]) as h
       on conflict (handle) do update set watch = 'watching', updated_at = now()
       returning handle`,
      [add],
    )
    watching = rows.map((row) => String(row.handle))
  }

  let dropped = 0
  if (dismiss.length > 0) {
    const rows = await sql.query(
      `update transcriber.creators set watch = 'dismissed', updated_at = now()
        where handle = any($1::text[]) returning handle`,
      [dismiss],
    )
    dropped = rows.length
  }

  return NextResponse.json({ watching, added: watching.length, dismissed: dropped })
}
