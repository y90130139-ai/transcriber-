import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { handlesIn } from '@/lib/handles'
import { loadWatchlist } from '@/lib/watchlist'

/**
 * The watchlist itself: who the sweep reads every week.
 *
 * Two ways in. A human pastes handles or profile links — that is how a niche
 * widens past the obvious, and a comedian or a cooking account can be watched
 * for its *format* even though nothing about it is this business. And the
 * sweep proposes accounts that collaborated on a winner, which land as
 * `suggested` and cost nothing until someone says watch.
 *
 * The read itself lives in `loadWatchlist` — the page renders from the same
 * function on the server, so its first paint never waits on this route.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json(await loadWatchlist())
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
