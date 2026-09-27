import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }
const MAX_ERROR = 500

/** The bot's answer for one question: `{ ok: true }` once posted, or
 *  `{ ok: false, error }` — kept, and never offered again, so a group the bot
 *  cannot reach does not get the same question retried every minute. */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const ok = body.ok === true
  const [row] = await sql.query(
    `update transcriber.plan_messages
        set relayed_at = case when $2 then now() end,
            relay_error = case when $2 then null else $3 end
      where id = $1 and author = 'model' and relayed_at is null and relay_error is null
      returning id`,
    [id, ok, ok ? null : String(body.error ?? 'The bot did not say why.').slice(0, MAX_ERROR)],
  )
  if (!row) return NextResponse.json({ error: 'not waiting' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
