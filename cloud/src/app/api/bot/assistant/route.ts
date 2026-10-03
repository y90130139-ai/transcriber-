import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { ask, MAX_QUESTION } from '@/lib/assistant/store'

/** A question can take several tool rounds; the bot waits up to 4 minutes. */
export const maxDuration = 300

/** /q from GOSIAN | OPS, relayed by the Gosian bot. Answers in OPS only. */
export async function POST(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  const chatId = typeof body?.chat_id === 'string' || typeof body?.chat_id === 'number' ? String(body.chat_id) : ''
  if (!question || !chatId) return NextResponse.json({ error: 'question and chat_id are required' }, { status: 400 })
  if (question.length > MAX_QUESTION) return NextResponse.json({ error: `keep it under ${MAX_QUESTION} characters` }, { status: 400 })
  try {
    const answer = await ask({
      question,
      chat_id: chatId,
      asker: typeof body?.asker === 'string' ? body.asker.slice(0, 80) : null,
      thread_id: typeof body?.thread_id === 'string' ? body.thread_id : null,
    })
    return NextResponse.json(answer)
  } catch (error) {
    console.error('assistant failed', error)
    return NextResponse.json({ error: 'The assistant could not answer that just now.' }, { status: 502 })
  }
}
