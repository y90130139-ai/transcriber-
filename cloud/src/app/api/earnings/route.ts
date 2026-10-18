import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { EARNINGS_WINDOWS, loadEarningsBoard, type EarningsWindow } from '@/lib/earnings/board'

/** The agency's OnlyFans earnings from Infloww. `?days=7|30|90`, 30 default. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (EARNINGS_WINDOWS as readonly number[]).includes(asked) ? (asked as EarningsWindow) : 30
  return NextResponse.json(await loadEarningsBoard(days))
}
