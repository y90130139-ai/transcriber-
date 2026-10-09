import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { isScheduler } from '@/lib/cron'
import { sql } from '@/lib/db'
import { BACKFILL_REELS, REFRESH_DAYS, REFRESH_REELS, startRun } from '@/lib/scout-apify'
import { MIN_BASELINE_REELS, targets } from '@/lib/scout'

export const maxDuration = 60

/** What one sweep may spend. The cap rides on the Apify run itself, so it
 *  holds even if nothing here is watching. */
const MAX_USD_PER_RUN = Number(process.env.SCOUT_MAX_USD ?? 8)

/**
 * Start the open half of the sweep, from the cloud.
 *
 * Returns as soon as Apify accepts the run: the results come back to
 * `/api/scout/apify-hook` when the actor finishes, minutes later. The Mac is
 * not involved, so this keeps running when it is off.
 */
export async function POST(request: Request) {
  if (!isScheduler(request) && !isWorker(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json({ error: 'APIFY_TOKEN is not set' }, { status: 503 })
  }

  const creators = await targets()
  const open = creators.filter((c) => c.access !== 'gated')
  const backfill = open.filter((c) => Number(c.sightings ?? 0) < MIN_BASELINE_REELS).map((c) => String(c.handle))
  const refresh = open.filter((c) => Number(c.sightings ?? 0) >= MIN_BASELINE_REELS).map((c) => String(c.handle))

  const base = new URL(request.url)
  const hookUrl = `${base.origin}/api/scout/apify-hook?k=${encodeURIComponent(process.env.CRON_SECRET ?? '')}`

  const started: { kind: string; run: string; handles: number }[] = []
  // Backfill and refresh are separate runs because they ask for different
  // depths. Each reports back on its own; picking is idempotent, so whichever
  // lands second simply picks whatever the first left eligible.
  for (const [kind, handles, limit, newerThan] of [
    ['backfill', backfill, BACKFILL_REELS, undefined],
    ['refresh', refresh, REFRESH_REELS, `${REFRESH_DAYS} days`],
  ] as const) {
    if (handles.length === 0) continue
    const run = await startRun({
      handles,
      limit,
      newerThan,
      maxUsd: MAX_USD_PER_RUN / 2,
      hookUrl,
    })
    await sql.query(
      `insert into transcriber.scout_runs (id, started_at, handles, notes)
       values ($1, now(), $2, $3::jsonb)
       on conflict (id) do nothing`,
      [run.id, handles.length, JSON.stringify({ kind, handles, dataset: run.datasetId, via: 'cloud' })],
    )
    started.push({ kind, run: run.id, handles: handles.length })
  }

  return NextResponse.json({ started, watched: creators.length })
}
