import { NextResponse } from 'next/server'
import { deleteThreadMessage, editThreadMessage, readThread } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'

type Params = { params: Promise<{ id: string; messageId: string }> }

/** Her own message, edited (Geno, 2026-10-13): the bubble gets a new body
 *  and an "edited" mark; the team's word is never touched. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, messageId } = await params

  const read = await readThread(id, 'model', session.modelId)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const text = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'The message cannot be empty.' }, { status: 400 })

  const ok = await editThreadMessage(id, messageId, 'model', text)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** Her own message, gone — a tombstone, not a hole. */
export async function DELETE(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, messageId } = await params

  const read = await readThread(id, 'model', session.modelId)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const ok = await deleteThreadMessage(id, messageId, 'model')
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
