import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { currentSession } from '@/lib/auth'
import {
  addThreadMembers,
  hideThreadForMember,
  isInboxKey,
  markThreadSeen,
  markThreadUnread,
  readThread,
  setThreadMuted,
  setThreadPhoto,
  setThreadTitle,
  type ThreadMember,
} from '@/lib/inbox'

type Params = { params: Promise<{ id: string }> }

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** One thread, as the console draws it. Opening it is reading it — the
 *  seen stamp rides inside readThread now, one round trip (2026-10-13). */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  // The viewer's own seat rides along, so a reaction is "mine" only when it
  // is actually theirs — several teammates can wear the same emoji without
  // borrowing each other's highlights (2026-10-13).
  const session = await currentSession()
  const read = await readThread(id, 'team', session?.id ?? null)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(read)
}

/** Add people, rename a group, set its picture, or run one of the list's
 *  right-click actions: mark-unread, mark-read, mute, unmute. Adding notes
 *  the room: "Geno has been added" (Geno, 2026-10-13). */
export async function PATCH(request: Request, { params }: Params) {
  const session = await currentSession()
  if (!session) return unauthorized()
  const { id } = await params

  const body = await request.json().catch(() => null)

  const action = typeof body?.action === 'string' ? (body.action as string) : null
  if (action) {
    const read = await readThread(id, 'team', null)
    if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (action === 'mark-unread') await markThreadUnread(id, 'team', null)
    else if (action === 'mark-read') await markThreadSeen(id, 'team', null)
    else if (action === 'mute') await setThreadMuted(id, true)
    else if (action === 'unmute') await setThreadMuted(id, false)
    else return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  const read = await readThread(id, 'team', null)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // The group's clothes: a name, a picture. Both sync to her phone the
  // moment they land (2026-10-13).
  if (typeof body?.title === 'string' || body?.title === null) {
    await setThreadTitle(id, typeof body.title === 'string' ? body.title : null)
  }
  if (typeof body?.photo_key === 'string' || body?.photo_key === null) {
    const key = typeof body.photo_key === 'string' ? body.photo_key : ''
    await setThreadPhoto(id, key && isInboxKey(key) && key.startsWith(`inbox/${id}/`) ? key : null)
  }

  // Add people keeps the team side of a running chat: a model never joins
  // an existing thread through this door.
  const asked = Array.isArray(body?.members) ? (body.members as Record<string, unknown>[]) : []
  const members: ThreadMember[] = asked
    .map((one) => ({
      type: 'team' as const,
      id: String(one?.id ?? ''),
      name: typeof one?.name === 'string' ? one.name : null,
    }))
    .filter((one) => one.id.length > 0)
  if (members.length > 0) {
    await addThreadMembers(id, members, { name: session.name ?? session.email })
  }
  return NextResponse.json({ ok: true })
}

/** Delete the chat - for the signed-in seat only: a hide, never a real
 *  delete. A reply newer than the hide brings it back (2026-10-13). */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await currentSession()
  if (!session) return unauthorized()
  const { id } = await params
  await hideThreadForMember(id, 'team', session.id)
  return NextResponse.json({ ok: true })
}
