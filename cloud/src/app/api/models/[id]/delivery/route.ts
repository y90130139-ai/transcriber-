import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

/**
 * The delivery folder — where she sends the footage.
 *
 * Its own route, like `template` and `solo`: the plan editor edits it without
 * carrying the whole model form, and the form's full-row update stays the only
 * writer of everything else. The link lands on her page under "Where to send
 * it", so it is validated the way the form validates it — anything a phone
 * cannot open is refused here rather than stored as a dead tap target.
 */
export async function PUT(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const raw = typeof body.drive_url === 'string' ? body.drive_url.trim().slice(0, 2000) : ''
  const drive_url = (() => {
    if (!raw) return null
    try {
      const parsed = new URL(raw)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : null
    } catch {
      return null
    }
  })()
  if (raw && !drive_url) {
    return NextResponse.json({ error: 'that is not a link a phone can open' }, { status: 400 })
  }

  const [model] = await sql.query(
    `update transcriber.models set drive_url = $2, updated_at = now()
      where id = $1
      returning id, drive_url`,
    [id, drive_url],
  )
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ id: String(model.id), drive_url: model.drive_url ?? null })
}
