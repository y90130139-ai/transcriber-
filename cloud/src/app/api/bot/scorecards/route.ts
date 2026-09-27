import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { dueScorecards } from '@/lib/performance/scorecard'

/** Weekly scorecards due now, each with the image URL Telegram will fetch. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ items: await dueScorecards(new URL(request.url).origin) })
}
