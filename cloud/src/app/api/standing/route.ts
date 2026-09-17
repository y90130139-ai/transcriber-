import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { loadStanding } from '@/lib/standing'

/** Every model's standing, for the roster and the sweep. Read-only. Its own
 *  endpoint rather than widened into /api/models, so nothing the roster
 *  already renders can change shape. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const standing = await loadStanding()
  return NextResponse.json({ standing: Object.fromEntries(standing) })
}
