import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { aiReady } from '@/lib/ai'
import { writeCard } from '@/lib/writer'

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 60

/** Cards per request. Each is one model call of a few seconds; this keeps a
 *  request well inside the function limit, and the console calls again until
 *  `remaining` is zero. */
const PER_REQUEST = 5

/** Write the T6 DM and three captions for the cards on this plan that do not
 *  have them yet. On demand only: the allowance is shared with Whisper. */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!aiReady()) return NextResponse.json({ error: 'Workers AI is not configured' }, { status: 503 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const rewrite = body.rewrite === true

  const todo = await sql.query(
    `select id from transcriber.plan_items
      where plan_id = $1 and ($2 or brief_short is null)
      order by position limit $3`,
    [id, rewrite, PER_REQUEST],
  )
  const results = []
  for (const row of todo) {
    try {
      results.push(await writeCard(String(row.id)))
    } catch (error) {
      results.push({ item_id: String(row.id), ok: false, reason: String(error).slice(0, 160) })
    }
  }
  const [left] = await sql.query(
    `select count(*)::int as n from transcriber.plan_items where plan_id = $1 and brief_short is null`, [id],
  )
  return NextResponse.json({ written: results.filter((r) => r.ok).length, results, remaining: Number(left?.n ?? 0) })
}
