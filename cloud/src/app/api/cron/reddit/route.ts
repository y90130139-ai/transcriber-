import { NextResponse } from 'next/server'
import { collect, collectDiscovery, collectRequirements } from '@/lib/reddit/collect'
import { getSettings } from '@/lib/reddit/settings'
import { discoveryDue } from '@/lib/reddit/requirementStore'
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
 * Each pass also advances the requirements board under its own budget, and
 * once a day (20h guard) fires the NSFW discovery sweep inside its own
 * 1,000-request allowance. `?job=requirements` / `?job=discover` run only
 * that piece; `?job=validate` stays trend validation only.
 */
export const maxDuration = 60

const REQUIREMENTS_CRON_BUDGET = 20

export async function GET(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const job = new URL(request.url).searchParams.get('job')
  try {
    const settings = await getSettings()
    if (job === 'requirements') {
      const requirements = await collectRequirements({ trigger: 'cron', budget: REQUIREMENTS_CRON_BUDGET })
      return NextResponse.json({ job: 'requirements', result: requirements })
    }
    if (job === 'discover') {
      const discovery = await collectDiscovery({ trigger: 'cron', budget: settings.discovery_per_pass })
      return NextResponse.json({ job: 'discover', result: discovery })
    }
    const trigger = job === 'validate' ? 'validation' : 'cron'
    const result = await collect({ trigger })
    let requirements: Awaited<ReturnType<typeof collectRequirements>> | null = null
    let discovery: Awaited<ReturnType<typeof collectDiscovery>> | null = null
    const wantsBoards = job !== 'validate'
    if (wantsBoards && settings.requirements_enabled && !settings.paused && !settings.emergency_stop) {
      requirements = await collectRequirements({ trigger: 'cron', budget: REQUIREMENTS_CRON_BUDGET })
    }
    if (wantsBoards && settings.discovery_enabled && !settings.paused && !settings.emergency_stop) {
      if (await discoveryDue().catch(() => false)) {
        discovery = await collectDiscovery({ trigger: 'cron', budget: settings.discovery_per_pass })
      }
    }
    return NextResponse.json({ job: trigger, result, requirements, discovery })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
