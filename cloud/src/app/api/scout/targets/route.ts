import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { MIN_BASELINE_REELS, PICK_WINDOW_DAYS, targets } from '@/lib/scout'
import { instagramAccounts, readSocials } from '@/lib/socials'

/** Who the Mac should sweep this run, with enough history per creator for it
 *  to choose between a deep backfill and a refresh of the pick window. The
 *  thresholds travel with the list so the Mac never carries its own copy. */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const creators = await targets()
  // Our own models' handles travel with the list so the daily pass can hold
  // them to a posting standard using the same reader that mines the watchlist
  // for ideas. Intel and compliance are the same measurement, different subject.
  //
  // *Every* Instagram each model runs, not just `models.handle`: several of
  // the roster keep two or three accounts, and reading one of them measures a
  // fraction of her week and reports it as the whole. Which account is winning
  // is a question only the full set can answer.
  const rows = await sql.query(
    `select handle, socials from transcriber.models
      where status = 'active'
      order by handle`,
  )
  const mine = [...new Set(
    rows.flatMap((row) =>
      instagramAccounts(row.handle as string | null, readSocials(row.socials))),
  )]
  return NextResponse.json({
    creators,
    mine,
    min_baseline: MIN_BASELINE_REELS,
    window_days: PICK_WINDOW_DAYS,
  })
}
