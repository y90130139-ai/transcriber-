import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { forwardThreadMessage, isThreadMember } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ id: string; messageId: string }> }

/** Forward (2026-10-13): the same words land in one of her other chats as a
 *  new message wearing a "Forwarded" mark. Both threads are hers to see —
 *  the gate is membership on each side, never a guess. */
export async function POST(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit(`app-inbox:${session.accountId}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const { id, messageId } = await params

  const body = await request.json().catch(() => null)
  const to = typeof body?.to === 'string' ? body.to : ''
  if (!to || to === id) return NextResponse.json({ error: 'Pick another chat.' }, { status: 400 })

  const [here, there] = await Promise.all([
    isThreadMember(id, 'model', session.modelId),
    isThreadMember(to, 'model', session.modelId),
  ])
  if (!here || !there) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [model] = await sql.query(`select name from transcriber.models where id = $1`, [session.modelId])
  const message = await forwardThreadMessage({
    fromThreadId: id,
    messageId,
    toThreadId: to,
    authorType: 'model',
    authorId: session.modelId,
    authorName: (model?.name as string | null) ?? session.name,
  })
  if (!message) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, message })
}
