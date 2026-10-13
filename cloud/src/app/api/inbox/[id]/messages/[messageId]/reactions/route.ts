import { NextResponse } from 'next/server'
import { currentSession, isSignedIn } from '@/lib/auth'
import { toggleThreadReaction } from '@/lib/inbox'

type Params = { params: Promise<{ id: string; messageId: string }> }

/** A tapback from the console (2026-10-13): the same toggle the app speaks,
 *  so the room's tally grows whoever reacts — the same emoji again takes it
 *  back, a different one replaces it. The answer is the new tally as this
 *  side sees it. */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, messageId } = await params

  const session = await currentSession()
  const body = await request.json().catch(() => null)
  const emoji = typeof body?.emoji === 'string' ? body.emoji : ''

  const reactions = await toggleThreadReaction({
    threadId: id,
    messageId,
    memberType: 'team',
    memberId: session?.id ?? 'team',
    emoji,
  })
  if (!reactions) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, reactions })
}
