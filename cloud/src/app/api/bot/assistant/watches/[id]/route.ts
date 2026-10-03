import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { decide } from '@/lib/assistant/watches'

const ACTIONS = new Set(['save', 'cancel', 'delete'])

/** A Save / Cancel / Delete tap on an alert, from the chat it belongs to. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { chat_id?: unknown; action?: unknown }
  const chatId = typeof body.chat_id === 'string' || typeof body.chat_id === 'number' ? String(body.chat_id) : ''
  const action = String(body.action)
  if (!chatId || !ACTIONS.has(action)) return NextResponse.json({ error: 'chat_id and a valid action are required' }, { status: 400 })
  const result = await decide(id, chatId, action as 'save' | 'cancel' | 'delete')
  if (!result) return NextResponse.json({ error: 'no such alert in this chat' }, { status: 404 })
  return NextResponse.json(result)
}
