import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { guardAccess } from '@/lib/access'
import { currentWeekOf } from '@/lib/dates'
import { digestFor } from '@/lib/digest'
import { readWeekOf } from '@/lib/models'

/** Computed live for any week — never cached, or an old week's payload would
 *  be served against a newer client. */
export const dynamic = 'force-dynamic'

/** The week's winners and what they had in common. `?week=` is any date in
 *  the week wanted; the current week by default. Readable by the console and
 *  by the Mac's Sunday job, which prints the headline into its log. */
export async function GET(request: Request) {
  if (!isWorker(request)) {
    const denied = await guardAccess(request)
    if (denied) return denied
  }
  const asked = new URL(request.url).searchParams.get('week')
  const weekOf = readWeekOf(asked, currentWeekOf())
  return NextResponse.json(await digestFor(weekOf))
}
