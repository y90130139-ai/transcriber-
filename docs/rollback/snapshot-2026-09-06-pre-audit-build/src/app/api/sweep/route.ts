import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { loadSweep } from '@/lib/sweep'

/** The operator's own view of the week: what is waiting on us, what is waiting
 *  on her, and whether the library still has anything to build next week from. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json(await loadSweep())
}
