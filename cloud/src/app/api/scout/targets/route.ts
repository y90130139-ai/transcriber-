import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { MIN_BASELINE_REELS, PICK_WINDOW_DAYS, targets } from '@/lib/scout'

/** Who the Mac should sweep this run, with enough history per creator for it
 *  to choose between a deep backfill and a refresh of the pick window. The
 *  thresholds travel with the list so the Mac never carries its own copy. */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const creators = await targets()
  // Our own models' handles travel with the list so the daily pass can hold
  // them to a posting standard using the same reader that mines the watchlist
  // for ideas. Intel and compliance are the same measurement, different subject.
  const mine = await sql.query(
    `select lower(handle) as handle from transcriber.models
      where status = 'active' and coalesce(handle, '') <> ''
      order by handle`,
  )
  return NextResponse.json({
    creators,
    mine: mine.map((row) => String(row.handle)),
    min_baseline: MIN_BASELINE_REELS,
    window_days: PICK_WINDOW_DAYS,
  })
}
