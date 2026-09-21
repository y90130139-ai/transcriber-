import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { currentWeekOf } from '@/lib/dates'
import { draftWeek } from '@/lib/draft'
import { ingestHers } from '@/lib/hers'
import { readWeekOf } from '@/lib/models'
import { weekFor } from '@/lib/split'

type Params = { params: Promise<{ id: string }> }

/** Her week as 70/20/10 would build it: reskins of her own winners, iterations
 *  of her middle, and the library sized back to the experiment budget it was
 *  always good at. Read-only — proposing, not writing. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const week = await weekFor(id)
  if (!week) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(week)
}

/**
 * Two actions, named rather than inferred:
 *
 *   ingest  put her graded posts through the library pipeline, so a reskin
 *           card has a clip and a transcript behind it, not a bare shortcode
 *   draft   write the split onto her week — always a draft, never sent
 */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : 'ingest'

  if (action === 'draft') {
    const weekOf = readWeekOf(body.week_of, currentWeekOf())
    const drafted = await draftWeek(id, weekOf)
    if (!drafted) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(drafted)
  }

  const result = await ingestHers(id)
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(result)
}
