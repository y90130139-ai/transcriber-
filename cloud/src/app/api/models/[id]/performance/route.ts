import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { WINDOWS, accountBreakdown, loadBoard, loadModels, type WindowDays } from '@/lib/performance/load'

type Params = { params: Promise<{ id: string }> }
const TAGS = new Set(['top', 'average', 'attention'])
const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** One model's analytics: the dashboard's numbers for her alone, plus each of
 *  her accounts on its own line. */
export async function GET(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (WINDOWS as readonly number[]).includes(asked) ? (asked as WindowDays) : 30
  // Her board and her per-account lines only share her handles, so they load
  // beside each other instead of one after the other (2026-10-09).
  const [board, accounts] = await Promise.all([
    loadBoard(days, id),
    loadModels(id).then((rows) => accountBreakdown(rows[0]?.handles ?? [], days)),
  ])
  const model = board.models[0]
  if (!model) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ...board, model, accounts })
}

/** Pin a tag — `{ tag: 'top' | 'average' | 'attention' }` — or `{ tag: null }`
 *  to go back to the automatic one. */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const tag = typeof body.tag === 'string' && TAGS.has(body.tag) ? body.tag : null
  if (body.tag !== null && tag === null) return NextResponse.json({ error: 'unknown tag' }, { status: 400 })
  const [row] = await sql.query(
    `update transcriber.models set performance_tag = $2, updated_at = now() where id = $1 returning performance_tag`,
    [id, tag],
  )
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ tag: row.performance_tag })
}
