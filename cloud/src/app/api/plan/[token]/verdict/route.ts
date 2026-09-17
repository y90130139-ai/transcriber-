import { NextResponse, after } from 'next/server'
import { sql } from '@/lib/db'
import { isDeclineCode } from '@/lib/decline'
import { logEvent } from '@/lib/events'
import { itemForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

const MAX_REASON = 500
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })



/**
 * She takes a card on, or turns it down.
 *
 * Hers to set and hers to change — a decline is not a refusal to be argued
 * with, it is information, and the sooner it arrives the sooner the slot can be
 * refilled. The console can read it and swap the card; it cannot overwrite it.
 *
 * Declining does not clear `filmed_at`. If she filmed it and then changed her
 * mind about it going out, both facts are true and both are worth keeping.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`verdict:${token}`, 90)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const owned = await itemForToken(token, body.item_id)
  if (!owned) return notFound()

  const verdict = body.verdict
  if (verdict !== 'accepted' && verdict !== 'declined' && verdict !== 'open') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const reason =
    verdict === 'declined' && typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, MAX_REASON)
      : null

  const code = verdict === 'declined' && isDeclineCode(body.code) ? body.code : null

  const [item] = await sql.query(
    `update transcriber.plan_items
        set accepted_at    = case when $2 = 'accepted' then coalesce(accepted_at, now()) else null end,
            declined_at    = case when $2 = 'declined' then coalesce(declined_at, now()) else null end,
            decline_reason = case when $2 = 'declined' then $3::text else null end,
            decline_code   = case when $2 = 'declined' then $4::text else null end,
            -- A change of mind is news. Surfacing it as unread is what puts it
            -- in front of Geno without her having to write a message too.
            seen_at        = case when $2 = 'open' then seen_at else null end
      where id = $1
      returning accepted_at, declined_at, decline_reason, decline_code`,
    [owned.id, verdict, reason, code],
  )
  if (!item) return notFound()

  // Only a change is an act, as with filming. Recorded after the response so
  // measurement never costs her a moment on the tap.
  if (verdict !== owned.verdict) {
    after(() => logEvent({
      modelId: owned.modelId, planId: owned.planId, itemId: owned.id,
      kind: verdict === 'accepted' ? 'accept' : verdict === 'declined' ? 'decline' : 'reopen',
    }))
  }

  return NextResponse.json({
    ok: true,
    verdict: item.declined_at ? 'declined' : item.accepted_at ? 'accepted' : 'open',
    decline_reason: (item.decline_reason as string | null) ?? null,
    decline_code: (item.decline_code as string | null) ?? null,
  })
}
