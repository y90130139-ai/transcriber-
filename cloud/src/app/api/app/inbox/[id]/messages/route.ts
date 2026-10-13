import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { isInboxKey, sendThreadMessage } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ id: string }> }

/** A message from her (2026-10-12): text, a photo or a video, or both. */
export async function POST(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit(`app-inbox:${session.accountId}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const { id } = await params

  const body = await request.json().catch(() => null)
  const text = typeof body?.body === 'string' ? body.body.trim() : ''

  const asked = (body?.attachment ?? null) as { key?: unknown; type?: unknown; name?: unknown } | null
  const attachmentKey = typeof asked?.key === 'string' ? asked.key : ''
  const attachmentType = typeof asked?.type === 'string' ? asked.type : ''
  const attachment =
    attachmentKey && isInboxKey(attachmentKey) && attachmentKey.startsWith(`inbox/${id}/`)
      ? {
          key: attachmentKey,
          type: /^(image|video)\//.test(attachmentType) ? attachmentType : 'image/jpeg',
          name: typeof asked?.name === 'string' ? asked.name.slice(0, 200) : null,
        }
      : null

  if (!text && !attachment) return NextResponse.json({ error: 'nothing to send' }, { status: 400 })

  // A quote, when the message answers another one (2026-10-13).
  const replyTo = typeof body?.reply_to === 'string' ? body.reply_to : null

  const [model] = await sql.query(`select name from transcriber.models where id = $1`, [session.modelId])
  const message = await sendThreadMessage({
    threadId: id,
    authorType: 'model',
    authorId: session.modelId,
    authorName: (model?.name as string | null) ?? session.name,
    body: text,
    attachment,
    replyToId: replyTo,
  })
  if (!message) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, message })
}
