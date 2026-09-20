import { NextResponse } from 'next/server'
import { isSignedIn, isWorker } from '@/lib/auth'
import { currentWeekOf } from '@/lib/dates'
import { digestFor } from '@/lib/digest'
import { readWeekOf } from '@/lib/models'

/** The week's winners and what they had in common. `?week=` is any date in
 *  the week wanted; the current week by default. Readable by the console and
 *  by the Mac's Sunday job, which prints the headline into its log. */
export async function GET(request: Request) {
  if (!isWorker(request) && !(await isSignedIn())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const asked = new URL(request.url).searchParams.get('week')
  const weekOf = readWeekOf(asked, currentWeekOf())
  return NextResponse.json(await digestFor(weekOf))
}
