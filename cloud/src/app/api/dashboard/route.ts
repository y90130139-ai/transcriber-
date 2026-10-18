import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { WINDOWS, loadBoard, type WindowDays } from '@/lib/performance/load'

/** The roster at a glance: totals, growth, who is moving, and the top reels.
 *  `?days=7|30|90`, 30 by default. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (WINDOWS as readonly number[]).includes(asked) ? (asked as WindowDays) : 30
  return NextResponse.json(await loadBoard(days))
}
