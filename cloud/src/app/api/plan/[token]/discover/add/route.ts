import { NextResponse } from 'next/server'
import { modelForToken } from '@/lib/plans'
import { addStarToWeek } from '@/lib/discover'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** `{ job_id }` — a starred reel onto her own working week, through the same
 *  door the console's Recreate uses. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`discover-add:${token}`, 30)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const model = await modelForToken(token)
  if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = await request.json().catch(() => null)
  if (typeof body?.job_id !== 'string') {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }
  const result = await addStarToWeek(model.id, body.job_id)
  if (!result.added) return NextResponse.json({ error: result.reason }, { status: 409 })
  return NextResponse.json({ ok: true, week_of: result.week_of })
}
