import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { loadSweep } from '@/lib/sweep'

/** The operator's own view of the week: what is waiting on us, what is waiting
 *  on her, and whether the library still has anything to build next week from. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  return NextResponse.json(await loadSweep())
}
