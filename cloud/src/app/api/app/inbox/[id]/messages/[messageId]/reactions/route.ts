import { NextResponse } from 'next/server'
import { isThreadMember, toggleThreadReaction } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ id: string; messageId: string }> }

/** Her tapback (2026-10-13): the same emoji again takes it back, a different
 *  one replaces it. The answer is the new tally as her side sees it, so the
 *  bubble can redraw without a second read. */
export async function POST(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit(`app-inbox:${session.accountId}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const { id, messageId } = await params

  if (!(await isThreadMember(id, 'model', session.modelId))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const emoji = typeof body?.emoji === 'string' ? body.emoji : ''

  const reactions = await toggleThreadReaction({
    threadId: id,
    messageId,
    memberType: 'model',
    memberId: session.modelId,
    emoji,
  })
  if (!reactions) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, reactions })
}
