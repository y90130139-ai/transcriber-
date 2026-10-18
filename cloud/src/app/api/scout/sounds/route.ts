import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { risingSounds } from '@/lib/scout'

/** Sounds that two or more watched creators used in the last fortnight,
 *  rising first. Read-only; the sweep is what fills it. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  return NextResponse.json({ sounds: await risingSounds() })
}
