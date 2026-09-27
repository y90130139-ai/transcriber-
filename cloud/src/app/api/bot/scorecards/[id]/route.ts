import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { recordScorecard } from '@/lib/performance/scorecard'

type Params = { params: Promise<{ id: string }> }

/** The bot's answer for one card — recorded either way, never re-sent. */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (typeof body.model_id !== 'string' || typeof body.week_of !== 'string') {
    return NextResponse.json({ error: 'model_id and week_of are required' }, { status: 400 })
  }
  const ok = body.ok === true
  const recorded = await recordScorecard(id, body.model_id, body.week_of, ok, ok ? null : String(body.error ?? 'no reason').slice(0, 500))
  return NextResponse.json({ recorded })
}
