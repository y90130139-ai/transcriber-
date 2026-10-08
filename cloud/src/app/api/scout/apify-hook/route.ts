import { NextResponse, after } from 'next/server'
import { isScheduler } from '@/lib/cron'
import { sql } from '@/lib/db'
import {
  candidates,
  enqueue,
  multiplierSpread,
  storeAccess,
  storeSightings,
  suggest,
  type Sighting,
} from '@/lib/scout'
import { accessFrom, datasetItems, runInfo, toSighting } from '@/lib/scout-apify'
import { macState } from '@/lib/fallback'

export const maxDuration = 60

/** Rows per insert. Small enough that one statement stays quick, large enough
 *  that a full backfill is a handful of them. */
const CHUNK = 500

/**
 * Apify calling back when a sweep run finishes.
 *
 * Everything the Mac's `bin/scout` does after a run — map, store, learn which
 * accounts are gated, pick the winners, log the run — happens here instead,
 * so the open half of the sweep needs no machine at home.
 *
 * Picking is idempotent (a picked sighting is stamped, and the queue dedupes
 * on `source_key`), so the backfill and refresh runs can land in any order and
 * either may pick what the other left eligible.
 */
export async function POST(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    | { resource?: { id?: string; defaultDatasetId?: string; status?: string }; eventType?: string }
    | null
  const runId = body?.resource?.id
  if (!runId) return NextResponse.json({ error: 'no run id in payload' }, { status: 400 })

  const [row] = await sql.query(`select notes from transcriber.scout_runs where id = $1`, [runId])
  const notes = (row?.notes ?? {}) as { handles?: string[]; kind?: string }
  const asked: string[] = Array.isArray(notes.handles) ? notes.handles : []

  const info = await runInfo(runId)
  const datasetId = body?.resource?.defaultDatasetId ?? info.datasetId
  if (!datasetId) return NextResponse.json({ error: 'no dataset for that run' }, { status: 404 })

  const { items, truncated } = await datasetItems(datasetId)
  const sightings = items
    .map(toSighting)
    .filter((s): s is Sighting => s !== null)

  let stored = 0
  for (let at = 0; at < sightings.length; at += CHUNK) {
    stored += await storeSightings(sightings.slice(at, at + CHUNK))
  }

  const access = accessFrom(items, asked)
  await storeAccess(access, asked)

  const picks = await candidates()
  const queued = await enqueue(picks, runId.slice(0, 40))
  const suggested = await suggest(picks.map((p) => p.post_id))
  const [spread] = await multiplierSpread()

  await sql.query(
    `update transcriber.scout_runs
        set finished_at = now(), sightings = $2, picked = $3, suggested = $4,
            gated = $5, cost_usd = $6,
            notes = notes || $7::jsonb
      where id = $1`,
    [
      runId,
      sightings.length,
      queued,
      suggested,
      access.filter((a) => a.access === 'gated').length,
      info.costUsd || null,
      JSON.stringify({
        spread,
        status: info.status,
        event: body?.eventType,
        truncated: truncated || undefined,
      }),
    ],
  )

  // Freshly queued winners carry CDN links that live about a day and a half.
  // If the Mac is not there to fetch them, the cloud should start now rather
  // than at tomorrow's cron, while those links still work.
  if (queued > 0) {
    const origin = new URL(request.url).origin
    after(async () => {
      const mac = await macState()
      if (!mac.stale) return
      await fetch(`${origin}/api/worker/cloud`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      }).catch(() => {})
    })
  }

  return NextResponse.json({ run: runId, stored, picked: picks.length, queued, suggested, truncated })
}
