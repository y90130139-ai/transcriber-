import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { alertPosted } from '@/lib/earnings/queue'

type Params = { params: Promise<{ id: string }> }

/** The bot posted this OPS alert; do not offer it again. */
export async function POST(request: Request, { params }: Params) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  return NextResponse.json({ ok: await alertPosted(id) })
}
