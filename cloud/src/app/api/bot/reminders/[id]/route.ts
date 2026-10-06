import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { recordReminder } from '@/lib/reminders-db'

type Params = { params: Promise<{ id: string }> }
const MAX_ERROR = 500

/** The bot's answer for one nudge — recorded whether it went or not, so the
 *  same reminder is never offered twice. The id is `<plan_id>:<kind>`. */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const split = id.lastIndexOf(':')
  if (split <= 0) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  await recordReminder(
    id.slice(0, split),
    id.slice(split + 1),
    body.ok === true,
    body.ok === true ? null : String(body.error ?? 'The bot did not say why.').slice(0, MAX_ERROR),
  )
  return NextResponse.json({ recorded: true })
}
