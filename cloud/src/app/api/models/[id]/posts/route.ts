import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params

  const [model] = await sql.query(
    `select handle from transcriber.models where id = $1`,
    [id],
  )
  if (!model) return notFound()

  const handle = (model.handle as string | null) ?? ''
  if (!handle) return NextResponse.json({ handle: null, posts: [] })

  const posts = await sql.query(
    `select j.id, j.status,
            t.webpage_url, t.upload_date, t.duration_sec,
            t.like_count, t.comment_count,
            (t.thumbnail is not null) as has_thumb,
            bound.item_id, bound.card_no,
            (r.post_id is not null) as repurposed, r.destination
       from transcriber.jobs j
       join transcriber.transcripts t on t.job_id = j.id
       left join lateral (
         -- Which card, if any, this post is already the delivery of. Matched on
         -- the URL that was bound by hand, never guessed.
         select i.id as item_id, i.card_no
           from transcriber.plan_items i
           join transcriber.plans p on p.id = i.plan_id
          where p.model_id = $2 and i.post_url = t.webpage_url
          limit 1
       ) bound on true
       left join transcriber.repurposes r on r.post_id = j.id
      where lower(t.author) = lower($1)
      order by t.upload_date desc nulls last, t.transcribed_at desc
      limit ${RECENT}`,
    [handle, id],
  )

  return NextResponse.json({ handle, posts })
}
