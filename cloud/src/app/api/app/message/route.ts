import { NextResponse, after } from 'next/server'
import { sql } from '@/lib/db'
import { logEvent } from '@/lib/events'
import { modelSessionFrom } from '@/lib/model-auth'
import { newId } from '@/lib/models'
import { itemForModel, modelById } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

const MAX_BODY = 2000
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

/**
 * The thread on one item, from her end — the app's session version of
 * `/api/plan/[token]/message`. Same two acts, told apart by the body:
 *
 *  - `{ item_id, note }` appends a message from her;
 *  - `{ item_id, seen: true }` marks our answers on that item as read.
 */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit(`app-message:${session.accountId}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const model = await modelById(session.modelId)
  if (!model) return notFound()

  const owned = await itemForModel(model, body.item_id)
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

  // Mirrored, not moved — the console's roster reads model_note, exactly as it
  // did before there was a thread.
  await sql.query(
    `update transcriber.plan_items
        set model_note = $2::text, model_note_at = now(), seen_at = null
      where id = $1`,
    [owned.id, note],
  )

  after(() => logEvent({ modelId: owned.modelId, planId: owned.planId, itemId: owned.id, kind: 'message' }))
  return NextResponse.json({ ok: true, message, note })
}
