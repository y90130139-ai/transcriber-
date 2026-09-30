import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { EARNINGS_WINDOWS, loadModelEarnings, type EarningsWindow } from '@/lib/earnings/board'

type Params = { params: Promise<{ id: string }> }

/** One model's earnings, all her OnlyFans accounts together. */
export async function GET(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const asked = Number(new URL(request.url).searchParams.get('days'))
  const days = (EARNINGS_WINDOWS as readonly number[]).includes(asked) ? (asked as EarningsWindow) : 30
  return NextResponse.json(await loadModelEarnings(id, days))
}
