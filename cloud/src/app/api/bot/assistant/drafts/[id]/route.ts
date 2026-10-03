import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { decideDraft, recordDraft } from '@/lib/assistant/drafts'

/** A drafted creator message: approve (Geno's tap - the bot checks who tapped),
 *  cancel, or the bot's report of the send. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { chat_id?: unknown; action?: unknown; ok?: unknown; error?: unknown; from_id?: unknown }
  if (body.action === 'sent') {
    return NextResponse.json({ recorded: await recordDraft(id, body.ok === true, typeof body.error === 'string' ? body.error : null) })
  }
  const chatId = typeof body.chat_id === 'string' || typeof body.chat_id === 'number' ? String(body.chat_id) : ''
  if (!chatId || (body.action !== 'approve' && body.action !== 'cancel')) {
    return NextResponse.json({ error: 'chat_id and action approve|cancel|sent are required' }, { status: 400 })
  }
  const fromId = typeof body.from_id === 'string' || typeof body.from_id === 'number' ? String(body.from_id) : null
  const result = await decideDraft(id, chatId, body.action, fromId)
  if (!result) return NextResponse.json({ error: 'no such draft in this chat' }, { status: 404 })
  return NextResponse.json(result)
}
