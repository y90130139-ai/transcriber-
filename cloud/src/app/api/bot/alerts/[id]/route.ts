import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { recordAlert } from '@/lib/assistant/watches'

/** The bot's answer for one alert: posted, or why not. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { ok?: unknown; error?: unknown }
  const recorded = await recordAlert(id, body.ok === true, typeof body.error === 'string' ? body.error : null)
  return NextResponse.json({ recorded })
}
