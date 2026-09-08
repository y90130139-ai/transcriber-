import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { previewBatch, writeBatch } from '@/lib/batch'
import { currentWeekOf } from '@/lib/dates'
import { readWeekOf } from '@/lib/models'

export const maxDuration = 60

const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

/** What one pass would draft. Writes nothing. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return unauthorized()
  const asked = new URL(request.url).searchParams.get('week')
  return NextResponse.json(await previewBatch(readWeekOf(asked, currentWeekOf())))
}

/**
 * Write the drafts that were just previewed.
 *
 * The picks come back from the client rather than being recomputed, so what
 * gets written is exactly what was looked at. Recomputing here would let the
 * two answers drift between the preview and the tap — a suggestion is ranked
 * partly on engagement, and engagement moves.
 *
 * Every week this opens is a draft. Nothing here can send anything, and there
 * is deliberately no parameter that would let it.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const weekOf = readWeekOf(body.week_of, currentWeekOf())
  const offered = Array.isArray(body.picks) ? body.picks : []

  return NextResponse.json(await writeBatch(weekOf, offered))
}
