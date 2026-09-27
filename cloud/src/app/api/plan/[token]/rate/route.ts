import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { itemForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/**
 * Her thumbs on one card: is this a good reference for her?
 *
 * `{ item_id, rating: 1 | -1 | 0 }` — up, down, or taken back. Stored on the
 * card (`plan_items.rating`), and read by `suggestionsFor` in `match.ts`: reels
 * like the ones she thumbs up rank higher for her, like the ones she thumbs
 * down rank lower (Geno, 2026-09-27: "helps the system push more content like
 * that out to them"). Nothing is posted to her group — it is a signal for the
 * picker, not a question for us — and `rated_at` is its record.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`rate:${token}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const body = await request.json().catch(() => null)
  const rating = body?.rating
  if (rating !== 1 && rating !== -1 && rating !== 0) {
    return NextResponse.json({ error: 'rating must be 1, -1 or 0' }, { status: 400 })
  }
  const owned = await itemForToken(token, body.item_id)
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await sql.query(
    `update transcriber.plan_items
        set rating = $2, rated_at = case when $2::smallint is null then null else now() end
      where id = $1`,
    [owned.id, rating === 0 ? null : rating],
  )
  return NextResponse.json({ ok: true, rating: rating === 0 ? null : rating })
}
