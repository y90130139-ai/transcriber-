import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { createEditor, listEditors, notifyEditor, updateEditor } from '@/lib/editors'

/** The editing team: list, add, edit, assign, notify. Console only. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ editors: await listEditors() })
}

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))

  // Point one card at one editor (or at nobody). Notes can still be in
  // progress; the assignment already gives the editor its creator plan link.
  if (typeof body.assign === 'object' && body.assign) {
    const itemId = typeof body.assign.item_id === 'string' ? body.assign.item_id : ''
    const editorId = typeof body.assign.editor_id === 'string' ? body.assign.editor_id : null
    if (!itemId) return NextResponse.json({ error: 'which card?' }, { status: 400 })
    await sql.query(
      `update transcriber.plan_items
          set editor_id = $2, editor_notified_at = null
        where id = $1`,
      [itemId, editorId],
    )
    return NextResponse.json({ ok: true })
  }

  if (typeof body.notify === 'string') {
    const origin = new URL(request.url).origin
    return NextResponse.json(await notifyEditor(body.notify, origin))
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'the editor needs a name' }, { status: 400 })
  const email = typeof body.email === 'string' && body.email.includes('@') ? body.email.trim() : null
  const id = await createEditor(name, email, body.is_head === true)
  return NextResponse.json({ id, editors: await listEditors() })
}

export async function PATCH(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await updateEditor(id, {
    name: typeof body.name === 'string' ? body.name.trim() : undefined,
    ...(('email' in body) ? { email: typeof body.email === 'string' && body.email.includes('@') ? body.email.trim() : null } : {}),
    is_head: typeof body.is_head === 'boolean' ? body.is_head : undefined,
  })
  return NextResponse.json({ editors: await listEditors() })
}
