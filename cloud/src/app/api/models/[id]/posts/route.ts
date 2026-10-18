import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/** Enough recent posts to cover a couple of weeks of hers without turning the
 *  strip into a second library. */
const RECENT = 40

/**
 * Her own posts, as the plan editor's tap-to-link strip needs them.
 *
 * These are library rows whose author is her handle — ingested metadata-only,
 * with `jobs.transcribe = false`, because what she posted needs a date and a
 * link and nothing that a speech pass would produce.
 *
 * Deliberately not matched to plan items automatically. Her version of a
 * reference shares no key with it — not the caption, not the audio, not the
 * length — so any guess is a coin toss, and a wrong one silently marks a card
 * posted that never was. Binding is a tap.
 */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  // One round trip, not two. The model lookup and her posts used to be two
  // sequential queries on the sheet's first paint, and each one is a full
  // database round trip. Her row now rides along as a marker: no row at all
  // means no model, a null handle means there is nothing to match on, and the
  // posts follow either way.
  const rows = await sql.query(
    `select m.handle as model_handle, j.id, j.status,
            t.webpage_url, t.upload_date, t.duration_sec,
            t.like_count, t.comment_count,
            (t.thumbnail is not null) as has_thumb,
            bound.item_id, bound.card_no,
            (r.post_id is not null) as repurposed, r.destination,
            r.status as repurpose_status
       from transcriber.models m
       left join transcriber.transcripts t on lower(t.author) = lower(m.handle)
       left join transcriber.jobs j on j.id = t.job_id
       left join lateral (
         -- Which card, if any, this post is already the delivery of. Matched on
         -- the URL that was bound by hand, never guessed.
         select i.id as item_id, i.card_no
           from transcriber.plan_items i
           join transcriber.plans p on p.id = i.plan_id
          where p.model_id = m.id and i.post_url = t.webpage_url
          limit 1
       ) bound on true
       left join transcriber.repurposes r on r.post_id = j.id
      where m.id = $1
      order by t.upload_date desc nulls last, t.transcribed_at desc
      limit ${RECENT + 1}`,
    [id],
  )

  if (rows.length === 0) return notFound()
  const handle = (rows[0].model_handle as string | null) ?? null
  if (!handle) return NextResponse.json({ handle: null, posts: [] })

  const posts = rows
    .filter((row) => row.id !== null)
    .slice(0, RECENT)
    .map(({ model_handle: _handle, ...post }) => post)

  return NextResponse.json({ handle, posts })
}
