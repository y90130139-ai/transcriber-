import { NextResponse, after } from 'next/server'
import { sql } from '@/lib/db'
import { newId } from '@/lib/models'
import { logEvent } from '@/lib/events'
import { itemForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** What lands in the card's thread, and so in her group chat and OPS through
 *  the Gosian bot's question relay (`/api/bot/questions`). */
const MORE_NOTE = 'More like this one, please.'

/**
 * "More like this" on one card, from her end.
 *
 * Susanna, 2026-09-27: she wanted more "Slavic girl" videos like V-25 and the
 * only way to say so was to type it into "Ask about this one". One tap now:
 * `plan_items.more_at` records it (the console can see what she wants more
 * of) and a message goes on the card's thread, which the bot relays like any
 * question. Once per card — a second tap changes nothing and sends nothing.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`more:${token}`, 30)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const owned = await itemForToken(token, body.item_id)
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [first] = await sql.query(
    `update transcriber.plan_items set more_at = now()
      where id = $1 and more_at is null
      returning id`,
    [owned.id],
  )
  if (!first) return NextResponse.json({ ok: true, already: true })

  await sql.query(
    `insert into transcriber.plan_messages (id, item_id, author, body) values ($1, $2, 'model', $3)`,
    [newId(), owned.id, MORE_NOTE],
  )
  // Mirrored like any message, so the roster floats her card up as unread.
  await sql.query(
    `update transcriber.plan_items
        set model_note = $2::text, model_note_at = now(), seen_at = null
      where id = $1`,
    [owned.id, MORE_NOTE],
  )
  after(() => logEvent({ modelId: owned.modelId, planId: owned.planId, itemId: owned.id, kind: 'message' }))
  return NextResponse.json({ ok: true })
}
