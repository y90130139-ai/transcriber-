import { NextResponse, after } from 'next/server'
import { isWorker } from '@/lib/auth'
import { isScheduler } from '@/lib/cron'
import { macState, runFallback, STALE_AFTER_MIN } from '@/lib/fallback'

export const maxDuration = 60

/**
 * Stand in for the Mac, if the Mac is not there.
 *
 * Checks the heartbeat first and does nothing while it is fresh — this is a
 * fallback, not a second worker competing for jobs. When the Mac has been
 * silent for STALE_AFTER_MIN it transcribes what it can and pushes plan
 * videos to R2, then chains another pass if work is left, so a long outage
 * drains rather than waiting a day for the next cron.
 */
export async function POST(request: Request) {
  if (!isScheduler(request) && !isWorker(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const forced = url.searchParams.get('force') === '1'
  const mac = await macState()
  if (!mac.stale && !forced) {
    return NextResponse.json({ skipped: 'the Mac is working', seen_ago_min: mac.seenAgoMin })
  }

  const result = await runFallback(url.origin)

  // Chain, rather than loop: each pass is its own function with its own
  // 60 seconds, and the chain stops as soon as there is nothing left.
  if (result.remaining > 0 && (result.transcribed > 0 || result.uploaded > 0)) {
    const next = `${url.origin}/api/worker/cloud?force=${forced ? '1' : '0'}`
    after(async () => {
      await fetch(next, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      }).catch(() => {})
    })
  }

  return NextResponse.json({
    mac: { seen_ago_min: mac.seenAgoMin, stale: mac.stale, stale_after_min: STALE_AFTER_MIN },
    ...result,
  })
}
