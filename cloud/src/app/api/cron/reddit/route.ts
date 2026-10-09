import { NextResponse } from 'next/server'
import { collect, collectRequirements } from '@/lib/reddit/collect'
import { getSettings } from '@/lib/reddit/settings'
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
 *
 * Each pass also gives the requirements board a slice of the same run
 * (`?job=requirements` runs only that pass; `?job=validate` stays trend
 * validation only). The requirements collector shares the client's pacing,
 * budget guards and daily cap, so it cannot spend a request the trend
 * collector would not have spent.
 */
export const maxDuration = 60

const REQUIREMENTS_CRON_BUDGET = 20

export async function GET(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const job = new URL(request.url).searchParams.get('job')
  try {
    if (job === 'requirements') {
      const requirements = await collectRequirements({ trigger: 'cron', budget: REQUIREMENTS_CRON_BUDGET })
      return NextResponse.json({ job: 'requirements', result: requirements })
    }
    const trigger = job === 'validate' ? 'validation' : 'cron'
    const result = await collect({ trigger })
    let requirements: Awaited<ReturnType<typeof collectRequirements>> | null = null
    const wantsRequirements = job !== 'validate'
    if (wantsRequirements) {
      const settings = await getSettings()
      if (settings.requirements_enabled && !settings.paused && !settings.emergency_stop) {
        requirements = await collectRequirements({ trigger: 'cron', budget: REQUIREMENTS_CRON_BUDGET })
      }
    }
    return NextResponse.json({ job: trigger, result, requirements })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
