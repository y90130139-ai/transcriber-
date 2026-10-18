import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { EARNINGS_WINDOWS, loadReelHits, type EarningsWindow } from '@/lib/earnings/board'

/** Reel days that were hits and were followed by money. Deferred on purpose:
 *  the board paints first, the console fetches this right after. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (EARNINGS_WINDOWS as readonly number[]).includes(asked) ? (asked as EarningsWindow) : 30
  return NextResponse.json({ reelHits: await loadReelHits(days) })
}
