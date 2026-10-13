import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * The OFMPro worker's ear on the cloud (2026-10-09).
 *
 * The worker runs where the browser runs — Railway, behind a residential
 * proxy — and holds no database credentials, exactly like the Mac worker
 * before it. Everything it knows comes from here and everything it found goes
 * back through here.
 *
 * GET answers three things in one read:
 *   - each platform's date coverage, so the regular window can continue at the
 *     latest date and a one-time rescan can restart at the earliest date;
 *   - what still has no R2 copy and a live-enough source URL to fetch;
 *   - the last run, so a quiet console day has an explanation.
 */
export async function GET(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const wanted = Number(url.searchParams.get('downloads'))
  const downloadLimit = Number.isFinite(wanted) && wanted > 0 ? Math.min(Math.trunc(wanted), 1_000) : 40

  const [coverage, pending, lastRun, totals] = await Promise.all([
    sql.query(
      `select platform,
              to_char(min(posted_at)::date, 'YYYY-MM-DD') as earliest,
              to_char(max(posted_at)::date, 'YYYY-MM-DD') as latest,
              count(*)::int as held
         from transcriber.ofmpro_media
        group by platform
        order by platform`,
    ),
    sql.query(
      `select platform, media_id, raw_url, mirror_url, media_type
         from transcriber.ofmpro_media
        where r2_key is null and (raw_url is not null or mirror_url is not null)
        order by posted_at desc nulls last
        limit ${downloadLimit}`,
    ),
    sql.query(
      `select id, started_at, finished_at, status, window_from, window_to,
              fetched, inserted, updated, downloaded, failed, error
         from transcriber.ofmpro_runs
        order by started_at desc
        limit 1`,
    ),
    sql.query(
      `select count(*)::int as total,
              count(*) filter (where r2_key is not null)::int as mirrored
         from transcriber.ofmpro_media`,
    ),
  ])

  return NextResponse.json({
    coverage,
    pending,
    lastRun: lastRun[0] ?? null,
    totals: totals[0] ?? { total: 0, mirrored: 0 },
  })
}
