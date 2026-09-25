import { NextResponse } from 'next/server'
import { isSignedIn, isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { aiReady } from '@/lib/ai'
import { writeCard } from '@/lib/writer'
import { writeWeekCaptions } from '@/lib/captions'

type Params = { params: Promise<{ id: string }> }

/** The caption call writes a whole week in one answer, which runs well past
 *  the old 60s a batch of five DMs needed. */
export const maxDuration = 300

/** DMs per request. Each is one model call of a few seconds; this keeps a
 *  request well inside the function limit, and the console calls again until
 *  `remaining` is zero. */
const PER_REQUEST = 5

/**
 * Write the week's copy, in two phases.
 *
 * First the DMs, five cards a request. Then, once every card has one, the
 * captions for the whole week in a single request (`captions.ts`) — counted
 * as one more step in `remaining`, so the console's loop runs it without
 * knowing there are phases. `{"captions": true}` rewrites only the week's
 * captions, which is how the caption engine is re-run on a written week;
 * `"model": "default"` uses the free 70B instead of gpt-oss-120b, and
 * `"dry": true` shows the result without storing it.
 * On demand only: the allowance is shared with Whisper.
 */
export async function POST(request: Request, { params }: Params) {
  // The console button, or the worker secret — the same pair `/api/retag`
  // takes, so this can be run for a whole week from a terminal or a timer
  // rather than only by somebody holding the page open.
  if (!(isWorker(request) || (await isSignedIn()))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!aiReady()) return NextResponse.json({ error: 'Workers AI is not configured' }, { status: 503 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (body.captions === true) {
    const captions = await writeWeekCaptions(id, {
      rewrite: true,
      model: body.model === 'default' ? 'default' : 'strong',
      dry: body.dry === true,
    })
    return NextResponse.json({ written: captions.ok ? 1 : 0, captions, remaining: 0 })
  }

  const todo = await sql.query(
    `select id from transcriber.plan_items
      where plan_id = $1 and brief_short is null
      order by position limit $2`,
    [id, PER_REQUEST],
  )
  if (todo.length) {
    const results = []
    for (const row of todo) {
      try {
        results.push(await writeCard(String(row.id)))
      } catch (error) {
        results.push({ item_id: String(row.id), ok: false, reason: String(error).slice(0, 160) })
      }
    }
    return NextResponse.json({ written: results.filter((r) => r.ok).length, results, remaining: await remaining(id) })
  }

  const captions = await writeWeekCaptions(id).catch((error) => ({
    ok: false, reason: String(error).slice(0, 160), cards: 0, captions: 0, short: 0, repaired: false,
  }))
  return NextResponse.json({ written: captions.ok ? 1 : 0, captions, remaining: 0 })
}

/** Cards still without a DM, plus one for the week's captions if any card
 *  has none. */
async function remaining(planId: string): Promise<number> {
  const [row] = await sql.query(
    `select count(*) filter (where brief_short is null)::int as dms,
            bool_or(caption_options is null or caption_options = '[]'::jsonb) as captions
       from transcriber.plan_items where plan_id = $1`,
    [planId],
  )
  return Number(row?.dms ?? 0) + (row?.captions ? 1 : 0)
}
