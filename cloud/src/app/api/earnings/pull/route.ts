import { NextResponse, after } from 'next/server'
import { isScheduler } from '@/lib/cron'
import { runEarnings } from '@/lib/earnings/job'

export const maxDuration = 300
const BUDGET_MS = 240_000
const MAX_HOPS = 6

/** The daily earnings run (lib/earnings/job.ts). Called by the daily cron.
 *  A run that runs out of time keeps what it saved and calls itself again,
 *  up to six times, so a backfill finishes the same morning. */
export async function POST(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const hop = Number(url.searchParams.get('hop') ?? 0)
  const result = await runEarnings({ deadline: Date.now() + BUDGET_MS })
  if (!result.complete && hop < MAX_HOPS) {
    after(() => fetch(`${url.origin}/api/earnings/pull?hop=${hop + 1}`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    }).then(() => undefined, () => undefined))
  }
  return NextResponse.json({ ...result, hop })
}

/** Vercel Cron calls with GET. */
export const GET = POST
