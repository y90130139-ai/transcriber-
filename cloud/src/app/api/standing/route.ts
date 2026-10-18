import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { loadStanding } from '@/lib/standing'

/** Every model's standing, for the roster and the sweep. Read-only. Its own
 *  endpoint rather than widened into /api/models, so nothing the roster
 *  already renders can change shape. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const standing = await loadStanding()
  return NextResponse.json({ standing: Object.fromEntries(standing) })
}
