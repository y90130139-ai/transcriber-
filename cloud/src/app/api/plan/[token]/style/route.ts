import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { modelForToken } from '@/lib/plans'
import { cleanStyle } from '@/lib/portal-style'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** `{ pal?, font? }` — her look, from the Make-it-yours panel. Unknown keys
 *  are dropped, defaults are stored as absence, and the whole thing only
 *  ever touches how HER pages render. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`style:${token}`, 30)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const model = await modelForToken(token)
  if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const style = cleanStyle(await request.json().catch(() => null))
  await sql.query(
    `update transcriber.models set portal_style = $2 where id = $1`,
    [model.id, Object.keys(style).length > 0 ? JSON.stringify(style) : null],
  )
  return NextResponse.json({ ok: true, style })
}
