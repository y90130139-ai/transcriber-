import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { recordShoutout } from '@/lib/performance/shoutouts'

type Params = { params: Promise<{ id: string }> }
const MAX_ERROR = 500

/** The bot's answer for one shout-out — recorded whether it went or not, so
 *  the same congratulations is never offered twice. */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const kind = body.kind === 'weekly' || body.kind === 'instant' ? body.kind : null
  if (!kind || typeof body.model_id !== 'string') return NextResponse.json({ error: 'kind and model_id are required' }, { status: 400 })
  const recorded = await recordShoutout(
    {
      id,
      model_id: body.model_id,
      kind,
      week_of: typeof body.week_of === 'string' ? body.week_of : null,
      post_ids: Array.isArray(body.post_ids) ? body.post_ids.filter((p: unknown) => typeof p === 'string').slice(0, 10) : [],
    },
    body.ok === true,
    body.ok === true ? null : String(body.error ?? 'The bot did not say why.').slice(0, MAX_ERROR),
  )
  return NextResponse.json({ recorded })
}
