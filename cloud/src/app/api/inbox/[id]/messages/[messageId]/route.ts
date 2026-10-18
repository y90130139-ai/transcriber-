import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { deleteThreadMessage, editThreadMessage } from '@/lib/inbox'

type Params = { params: Promise<{ id: string; messageId: string }> }


/** Edit the team's own message (Geno, 2026-10-13): the bubble gets a new
 *  body and an "edited" mark; a model's word is never touched. */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id, messageId } = await params

  const body = await request.json().catch(() => null)
  const text = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'The message cannot be empty.' }, { status: 400 })

  const ok = await editThreadMessage(id, messageId, 'team', text)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** Remove the team's own message from the thread. */
export async function DELETE(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id, messageId } = await params

  const ok = await deleteThreadMessage(id, messageId, 'team')
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
