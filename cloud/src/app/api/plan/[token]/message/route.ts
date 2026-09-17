import { NextResponse, after } from 'next/server'
import { sql } from '@/lib/db'
import { newId } from '@/lib/models'
import { logEvent } from '@/lib/events'
import { itemForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

const MAX_BODY = 2000
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

/**
 * The thread on one item, from her end.
 *
 * Two things happen here, told apart by the body:
 *
 *  - `{ item_id, note }` appends a message from her. Appends — nothing she has
 *    already sent is ever rewritten or removed, by her or by us.
 *  - `{ item_id, seen: true }` marks Geno's answers on that item as read, which
 *    is what clears the count on her Ask button. Sent when she opens the
 *    thread, not when the page loads, so a badge she never looked at survives.
 *
 * `plan_items.model_note` is still kept in step with her most recent message.
 * The console's roster count and its "She said" panel both read that column,
 * and this change is not allowed to break either of them.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`message:${token}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const owned = await itemForToken(token, body.item_id)
  if (!owned) return notFound()

  // She has read what we told her.
  if (body.seen === true) {
    await sql.query(
      `update transcriber.plan_messages
          set seen_at = now()
        where item_id = $1 and author = 'operator' and seen_at is null`,
      [owned.id],
    )
    return NextResponse.json({ ok: true, unread: 0 })
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_BODY) : ''
  if (note.length === 0) {
    return NextResponse.json({ error: 'nothing to say' }, { status: 400 })
  }

  const [message] = await sql.query(
    `insert into transcriber.plan_messages (id, item_id, author, body)
     values ($1, $2, 'model', $3)
     returning id, author, body,
               to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
               false as seen`,
    [newId(), owned.id, note],
  )

  // Mirrored, not moved. Clearing seen_at is what floats it back up the roster
  // as unread, exactly as it did before there was a thread.
  await sql.query(
    `update transcriber.plan_items
        set model_note = $2::text, model_note_at = now(), seen_at = null
      where id = $1`,
    [owned.id, note],
  )

  after(() => logEvent({ modelId: owned.modelId, planId: owned.planId, itemId: owned.id, kind: 'message' }))
  return NextResponse.json({ ok: true, message, note })
}
