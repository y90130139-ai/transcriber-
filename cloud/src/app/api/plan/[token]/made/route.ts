import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { newId } from '@/lib/models'
import { itemForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'
import { REPURPOSE_HOLD } from '@/lib/repurpose'

type Params = { params: Promise<{ token: string }> }

const MAX_URL = 500
/** A link to her own post: Instagram or TikTok, nothing else. */
const POST_URL = /^https:\/\/(www\.)?(instagram\.com|tiktok\.com|vm\.tiktok\.com)\//i

/**
 * "I've made this one already", from her end.
 *
 * Geno, 2026-09-27: some references on Susanna's week were videos she had
 * already made, and nothing recognised them. Once she says so the card is not
 * hers to film again — it becomes a Repurpose card (`bucket = 'repurpose'`):
 * the team refreshes her existing video and sends it back to post. The bucket
 * it had is kept in `made_from_bucket` so she can take it back, until the
 * refreshed file has gone out (`repurposed_at`).
 *
 * A message goes on the card's thread, so the bot relays it to her group and
 * OPS like a question — the work lands on the team, and the team needs to know.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`made:${token}`, 30)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const body = await request.json().catch(() => null)
  if (typeof body?.made !== 'boolean') return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const owned = await itemForToken(token, body.item_id)
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (!body.made) {
    const [row] = await sql.query(
      `update transcriber.plan_items
          set bucket = made_from_bucket, made_at = null, made_url = null, made_from_bucket = null, hold = null
        where id = $1 and made_at is not null and repurposed_at is null
        returning id`,
      [owned.id],
    )
    return row
      ? NextResponse.json({ ok: true, made: false })
      : NextResponse.json({ error: 'already_sent_back' }, { status: 409 })
  }

  const raw = typeof body.url === 'string' ? body.url.trim().slice(0, MAX_URL) : ''
  if (raw && !POST_URL.test(raw)) {
    return NextResponse.json({ error: 'That link is not an Instagram or TikTok post.' }, { status: 400 })
  }
  const url = raw || null

  const [row] = await sql.query(
    `update transcriber.plan_items
        set made_from_bucket = bucket, bucket = 'repurpose', made_at = now(), made_url = $2,
            hold = $3, accepted_at = coalesce(accepted_at, now()), declined_at = null,
            decline_code = null, decline_reason = null
      where id = $1 and made_at is null and coalesce(bucket, '') <> 'repurpose'
      returning id`,
    [owned.id, url, REPURPOSE_HOLD],
  )
  if (!row) return NextResponse.json({ ok: true, already: true })

  const note = url
    ? `I've made this one already — can you repurpose it? My post: ${url}`
    : `I've made this one already — can you repurpose it?`
  await sql.query(
    `insert into transcriber.plan_messages (id, item_id, author, body) values ($1, $2, 'model', $3)`,
    [newId(), owned.id, note],
  )
  await sql.query(
    `update transcriber.plan_items set model_note = $2::text, model_note_at = now(), seen_at = null where id = $1`,
    [owned.id, note],
  )
  return NextResponse.json({ ok: true, made: true, url })
}
