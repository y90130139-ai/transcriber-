import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { risingSounds } from '@/lib/scout'

/** Sounds that two or more watched creators used in the last fortnight,
 *  rising first. Read-only; the sweep is what fills it. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ sounds: await risingSounds() })
}
