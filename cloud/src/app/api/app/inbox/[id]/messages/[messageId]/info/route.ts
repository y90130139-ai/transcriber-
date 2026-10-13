import { NextResponse } from 'next/server'
import { isThreadMember, messageSeenBy, singleThreadMessage } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'

type Params = { params: Promise<{ id: string; messageId: string }> }

/** One message, in full (2026-10-13): the words as they stand, when it was
 *  sent, and who has seen it — each side's own stamp, the team collapsed
 *  into one entry because it shares a single seen state. */
export async function GET(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, messageId } = await params

  if (!(await isThreadMember(id, 'model', session.modelId))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const [message, seen] = await Promise.all([
    singleThreadMessage(id, messageId, 'model', session.modelId),
    messageSeenBy(id, messageId),
  ])
  if (!message || !seen) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    message,
    sent_at: seen.sent_at,
    encrypted: false,
    seen_by: seen.seen_by,
  })
}
