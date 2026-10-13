import { NextResponse } from 'next/server'
import {
  hideThreadForMember,
  isInboxKey,
  markThreadSeen,
  markThreadUnread,
  readThread,
  setMemberMuted,
  setThreadPhoto,
  setThreadTitle,
} from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'

type Params = { params: Promise<{ id: string }> }

/** One thread, hers only. Membership is the gate; anything else is a flat
 *  404 — never a 403, which would confirm a thread exists. */
export async function GET(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const read = await readThread(id, 'model', session.modelId)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(read)
}

/** Her seat's word on a thread (Geno, 2026-10-13): mark unread, mute her
 *  own notifications, rename the group, set its picture. All per seat —
 *  the room never feels it until it looks. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const read = await readThread(id, 'model', session.modelId)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await request.json().catch(() => null)

  const action = typeof body?.action === 'string' ? (body.action as string) : null
  if (action === 'mark-unread') await markThreadUnread(id, 'model', session.modelId)
  else if (action === 'mark-read') await markThreadSeen(id, 'model', session.modelId)
  else if (action === 'mute') await setMemberMuted(id, session.modelId, true)
  else if (action === 'unmute') await setMemberMuted(id, session.modelId, false)
  else if (action) return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  if (typeof body?.title === 'string' || body?.title === null) {
    // Only groups carry names - a 1:1 keeps the person's own.
    if (read.thread.members.length > 2) {
      await setThreadTitle(id, typeof body.title === 'string' ? body.title : null)
    }
  }
  if (typeof body?.photo_key === 'string' || body?.photo_key === null) {
    const key = typeof body.photo_key === 'string' ? body.photo_key : ''
    await setThreadPhoto(id, key && isInboxKey(key) && key.startsWith(`inbox/${id}/`) ? key : null)
  }

  return NextResponse.json({ ok: true })
}

/** Delete chat, for her seat only - a hide. A reply brings it back. */
export async function DELETE(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const read = await readThread(id, 'model', session.modelId)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await hideThreadForMember(id, 'model', session.modelId)
  return NextResponse.json({ ok: true })
}
