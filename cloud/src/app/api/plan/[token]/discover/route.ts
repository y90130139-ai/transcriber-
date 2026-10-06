import { NextResponse } from 'next/server'
import { modelForToken } from '@/lib/plans'
import { discoverFor, actOnCard } from '@/lib/discover'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** Her deck and her starred shelf. The token authorises it exactly as it
 *  authorises her plan. */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`discover:${token}`, 30)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const model = await modelForToken(token)
  if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(await discoverFor(model.id))
}

/** `{ job_id, action: 'star' | 'pass' }` — her swipe. Stars reach OPS through
 *  the bot (lib/discover.ts) and feed her taste scores; passes just never
 *  come back. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`discover:${token}`, 120)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const model = await modelForToken(token)
  if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = await request.json().catch(() => null)
  const action = body?.action
  if ((action !== 'star' && action !== 'pass') || typeof body?.job_id !== 'string') {
    return NextResponse.json({ error: 'job_id and action (star|pass) are required' }, { status: 400 })
  }
  const acted = await actOnCard(model.id, body.job_id, action)
  if (!acted) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
