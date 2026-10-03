import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { listWatches } from '@/lib/assistant/watches'

/** /q alerts: the alerts saved in one chat. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const chatId = new URL(request.url).searchParams.get('chat_id')
  if (!chatId) return NextResponse.json({ error: 'chat_id is required' }, { status: 400 })
  return NextResponse.json({ items: await listWatches(chatId) })
}
