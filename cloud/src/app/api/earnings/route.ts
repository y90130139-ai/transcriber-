import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { EARNINGS_WINDOWS, loadEarningsBoard, type EarningsWindow } from '@/lib/earnings/board'

/** The agency's OnlyFans earnings from Infloww. `?days=7|30|90`, 30 default. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (EARNINGS_WINDOWS as readonly number[]).includes(asked) ? (asked as EarningsWindow) : 30
  return NextResponse.json(await loadEarningsBoard(days))
}
