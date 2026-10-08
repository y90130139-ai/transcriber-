import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

// Daily header snapshots should land at 19:00 local; 26 hours allows for one
// missed/delayed run. The deeper reel sweep is weekly, so allow eight days.
const SNAPSHOT_STALE_HOURS = 26
const SWEEP_STALE_DAYS = 8

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const requestBody = await request.json().catch(() => ({}))
  const scrapingEnabled = requestBody?.scraping_enabled === true

  const [row] = await sql.query(
    `select
       (select max(seen_at) from transcriber.creator_snapshots) as snapshot_at,
       (select max(started_at) from transcriber.scout_runs
         where notes->>'kind' is distinct from 'autodraft') as sweep_at,
       (select coalesce(notes->'errors', '[]'::jsonb) from transcriber.scout_runs
         where notes->>'kind' is distinct from 'autodraft'
         order by started_at desc limit 1) as sweep_errors,
       extract(epoch from (now() - (select max(seen_at) from transcriber.creator_snapshots))) / 3600
         as snapshot_age_hours,
       extract(epoch from (now() - (select max(started_at) from transcriber.scout_runs
         where notes->>'kind' is distinct from 'autodraft'))) / 86400 as sweep_age_days`,
  )

  const snapshotAge = row?.snapshot_age_hours == null ? null : Number(row.snapshot_age_hours)
  const sweepAge = row?.sweep_age_days == null ? null : Number(row.sweep_age_days)
  const problems: string[] = []
  if (!scrapingEnabled) problems.push('Instagram scraping is disabled pending Railway egress validation')
  if (snapshotAge === null || snapshotAge > SNAPSHOT_STALE_HOURS) {
    problems.push(snapshotAge === null
      ? 'no Instagram profile snapshot has ever completed'
      : `daily profile snapshots are ${snapshotAge.toFixed(1)} hours old`)
  }
  if (sweepAge === null || sweepAge > SWEEP_STALE_DAYS) {
    problems.push(sweepAge === null
      ? 'no full Instagram sweep has ever completed'
      : `the last full Instagram sweep is ${sweepAge.toFixed(1)} days old`)
  }
  const sweepErrors = Array.isArray(row?.sweep_errors) ? row.sweep_errors : []
  if (sweepErrors.length > 0) {
    problems.push(`the most recent full sweep recorded ${sweepErrors.length} error(s)`)
  }

  const result = {
    healthy: problems.length === 0,
    snapshot_at: row?.snapshot_at ?? null,
    snapshot_age_hours: snapshotAge === null ? null : Math.round(snapshotAge * 10) / 10,
    sweep_at: row?.sweep_at ?? null,
    sweep_age_days: sweepAge === null ? null : Math.round(sweepAge * 10) / 10,
    sweep_errors: sweepErrors.length,
  }
  return NextResponse.json({ ...result, problems })
}
