import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { unrelayedStars, recordStarRelay } from '@/lib/discover'

/** Stars the bot has not told OPS about yet ("⭐ Susanna starred a reel").
 *  GET offers them; POST records one answer `{ model_id, job_id, ok, error }`
 *  — recorded on failure too, so nothing repeats. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await unrelayedStars()
  return NextResponse.json({
    items: rows.map((row) => ({
      model_id: String(row.model_id),
      job_id: String(row.job_id),
      model_name: String(row.model_name),
      url: (row.webpage_url as string | null) ?? null,
      preview: (row.preview as string | null)?.trim() || null,
    })),
  })
}

const MAX_ERROR = 500

export async function POST(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (typeof body.model_id !== 'string' || typeof body.job_id !== 'string') {
    return NextResponse.json({ error: 'model_id and job_id are required' }, { status: 400 })
  }
  await recordStarRelay(
    body.model_id,
    body.job_id,
    body.ok === true,
    body.ok === true ? null : String(body.error ?? 'The bot did not say why.').slice(0, MAX_ERROR),
  )
  return NextResponse.json({ recorded: true })
}
