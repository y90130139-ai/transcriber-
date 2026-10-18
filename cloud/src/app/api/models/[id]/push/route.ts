import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { pushToModel } from '@/lib/push'

type Params = { params: Promise<{ id: string }> }

/**
 * One push, to one model (Geno, 2026-10-14).
 *
 * The console composes it on her account page; `lib/push.ts` fans it out to
 * every phone she signed in on and prunes the dead ones. A model with no
 * devices is not an error — `sent: 0` lets the page say "she has not turned
 * notifications on" instead of failing like something broke.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const { id } = await params
  if (!id || id.length > 64) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : ''
  const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 400) : ''
  if (!title && !text) {
    return NextResponse.json({ error: 'Write a title or a message first.' }, { status: 400 })
  }

  const result = await pushToModel(id, {
    title: title || 'Gosian',
    body: text || title,
    data: { kind: 'console' },
  })
  return NextResponse.json({ ok: true, ...result })
}
