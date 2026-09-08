import { NextResponse } from 'next/server'
import { loadPlan } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** Her plan, as JSON. The token is the auth; there is no session anywhere near
 *  this route. Unknown, malformed and revoked tokens all come back 404. */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`plan:${token}`, 120)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const plan = await loadPlan(token)
  if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json(plan, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
