import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { attributionFor } from '@/lib/attribution'
import { addDays, currentWeekOf } from '@/lib/dates'
import { readWeekOf } from '@/lib/models'
import { reviewFor } from '@/lib/review'

type Params = { params: Promise<{ id: string }> }

/** Her week reviewed, the Sunday call sheet, and what her ladders have taught
 *  so far. `?week=` any date in the week; defaults to the week just ending. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const asked = new URL(request.url).searchParams.get('week')
  // The review is of the week that just ran, not the one being planned.
  const weekOf = readWeekOf(asked, addDays(currentWeekOf(), 0))
  const [review, attribution] = await Promise.all([reviewFor(id, weekOf), attributionFor(id)])
  if (!review) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ...review, attribution })
}
