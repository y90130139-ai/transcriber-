import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ planId: string }> }
const MAX_ERROR = 500

/**
 * The bot's answer for one week: `{ ok: true }` or `{ ok: false, error }`.
 * Only a week still waiting can be answered, so a retry after a timeout
 * cannot turn a posted week back into a failed one.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { planId } = await params
  const body = await request.json().catch(() => ({}))
  const ok = body.ok === true
  const error = ok ? null : String(body.error ?? 'The bot did not say why.').slice(0, MAX_ERROR)

  const [plan] = await sql.query(
    `update transcriber.plans
        set telegram_state = case when $2 then
                               case telegram_state when 'queued' then 'posted' else 'recorded' end
                             else 'failed' end,
            telegram_done_at = now(),
            telegram_error = $3
      where id = $1 and telegram_state in ('queued', 'manual')
      returning telegram_state`,
    [planId, ok, error],
  )
  if (!plan) return NextResponse.json({ error: 'not waiting' }, { status: 409 })
  return NextResponse.json({ state: plan.telegram_state })
}
