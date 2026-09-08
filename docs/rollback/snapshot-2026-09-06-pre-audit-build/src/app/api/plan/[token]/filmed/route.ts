import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { itemForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** Every refusal looks the same from outside: a 404 confirms nothing. */
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

/** She ticks one item off as filmed, or un-ticks it. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`filmed:${token}`, 90)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const owned = await itemForToken(token, body.item_id)
  if (!owned) return notFound()

  const filmed = body.filmed === true
  const [item] = await sql.query(
    `update transcriber.plan_items
        set filmed_at = case when $2::bool then coalesce(filmed_at, now()) else null end
      where id = $1
      returning (filmed_at is not null) as filmed`,
    [owned.id, filmed],
  )
  return NextResponse.json({ ok: true, filmed: Boolean(item?.filmed) })
}
