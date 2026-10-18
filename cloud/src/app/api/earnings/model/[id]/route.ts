import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { EARNINGS_WINDOWS, loadModelEarnings, type EarningsWindow } from '@/lib/earnings/board'

type Params = { params: Promise<{ id: string }> }

/** One model's earnings, all her OnlyFans accounts together. */
export async function GET(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (EARNINGS_WINDOWS as readonly number[]).includes(asked) ? (asked as EarningsWindow) : 30
  return NextResponse.json(await loadModelEarnings(id, days))
}
