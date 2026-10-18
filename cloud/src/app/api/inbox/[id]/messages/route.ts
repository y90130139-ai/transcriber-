import { guardAccess } from '@/lib/access'
import { NextResponse, after } from 'next/server'
import { currentSession } from '@/lib/auth'
import { addThreadMembers, isInboxKey, modelMembersOf, sendThreadMessage } from '@/lib/inbox'
import { pushToModel } from '@/lib/push'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

/** A message from the team (2026-10-12): text, a file, or both. The models in
 *  the thread are pushed, once. */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  const session = await currentSession()
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

  const message = await sendThreadMessage({
    threadId: id,
    authorType: 'team',
    authorId: session?.id ?? null,
    authorName: session?.name ?? session?.email ?? 'The team',
    body: text,
    attachment,
  })
  if (!message) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Whoever speaks is in the room - the rail's People list says so, and
  // marks them as You for themselves (Geno, 2026-10-13).
  if (session?.id) {
    after(async () => {
      await addThreadMembers(id, [{ type: 'team', id: session.id, name: session.name ?? null }]).catch(() => {})
    })
  }

  // Her phone, told once — silent if she has no device registered, and
  // silent for any seat that muted the chat (2026-10-13). The tap lands
  // straight in the room, not the list.
  const [thread] = await sql.query(`select title from transcriber.threads where id = $1`, [id])
  const preview = text.slice(0, 140) || (attachment ? (attachment.type.startsWith('video/') ? 'Video' : 'Photo') : 'New message')
  after(async () => {
    const modelIds = await modelMembersOf(id)
    await Promise.all(
      modelIds.map((modelId) =>
        pushToModel(modelId, {
          title: (thread?.title as string | null) ?? 'The team',
          body: preview,
          data: { url: `/thread/${id}` },
        }).catch(() => {}),
      ),
    )
  })

  return NextResponse.json({ ok: true, message })
}
