import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { recordSend } from '@/lib/survey/store'

type Params = { params: Promise<{ id: string }> }

/** The bot's answer for one send or reminder — recorded either way. */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (body.kind !== 'send' && body.kind !== 'reminder') {
    return NextResponse.json({ error: 'kind must be send or reminder' }, { status: 400 })
  }
  const ok = body.ok === true
  const recorded = await recordSend(id, body.kind, ok, ok ? null : String(body.error ?? 'no reason'))
  return NextResponse.json({ recorded })
}
