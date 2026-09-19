import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { MIN_BASELINE_REELS, PICK_WINDOW_DAYS, targets } from '@/lib/scout'

/** Who the Mac should sweep this run, with enough history per creator for it
 *  to choose between a deep backfill and a refresh of the pick window. The
 *  thresholds travel with the list so the Mac never carries its own copy. */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const creators = await targets()
  return NextResponse.json({
    creators,
    min_baseline: MIN_BASELINE_REELS,
    window_days: PICK_WINDOW_DAYS,
  })
}
