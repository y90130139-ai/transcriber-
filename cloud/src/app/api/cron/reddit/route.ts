import { NextResponse } from 'next/server'
import { collect } from '@/lib/reddit/collect'
import { isScheduler } from '@/lib/cron'

/**
 * The collection scheduler's entry point.
 *
 * Vercel's Hobby plan only fires a daily cron, so `/api/cron/daily` calls
 * this same logic once a day. The 15–60 minute cadence the brief asks for
 * needs a frequent caller: point any scheduler you already run (Railway
 * watchdog, GitHub Actions, cron-job.org) at this route with
 * `?k=$CRON_SECRET`. The collector paces itself and hands unprocessed jobs
 * back to the queue, so running it more often is safe by construction —
 * and running it less often only makes collection stale, never wrong.
 */
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const job = new URL(request.url).searchParams.get('job')
  try {
    const trigger = job === 'validate' ? 'validation' : 'cron'
    const result = await collect({ trigger })
    return NextResponse.json({ job: trigger, result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
