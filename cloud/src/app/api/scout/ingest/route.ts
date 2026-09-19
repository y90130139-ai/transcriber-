import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import {
  candidates,
  enqueue,
  multiplierSpread,
  parseAccess,
  parseSighting,
  storeAccess,
  storeSightings,
  suggest,
  type Access,
  type Sighting,
} from '@/lib/scout'

/** A request is one chunk of one sweep. Big enough to be few round trips,
 *  small enough to stay well inside a function's body and time limits. */
const MAX_SIGHTINGS = 1_000
const RUN_ID = /^[A-Za-z0-9_-]{6,40}$/

/**
 * The Mac posts a sweep here in chunks. Every chunk is stored; the chunk
 * marked `final` also picks the winners, queues them, writes suggestions and
 * logs the run. Picking only once, at the end, means a creator swept in the
 * first chunk is measured against the same finished picture as one swept in
 * the last.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 })
  }

  const runId = typeof body.run_id === 'string' && RUN_ID.test(body.run_id) ? body.run_id : null
  if (!runId) return NextResponse.json({ error: 'run_id is required' }, { status: 400 })

  const raw = Array.isArray(body.sightings) ? body.sightings : []
  if (raw.length > MAX_SIGHTINGS) {
    return NextResponse.json({ error: `at most ${MAX_SIGHTINGS} sightings per request` }, { status: 413 })
  }
  const sightings = raw.map(parseSighting).filter((s: Sighting | null): s is Sighting => s !== null)
  const access = (Array.isArray(body.access) ? body.access : [])
    .map(parseAccess)
    .filter((a: Access | null): a is Access => a !== null)
  const swept = (Array.isArray(body.swept) ? body.swept : [])
    .filter((h: unknown): h is string => typeof h === 'string')
    .map((h: string) => h.trim().toLowerCase())

  const stored = await storeSightings(sightings)
  await storeAccess(access, swept)

  if (body.final !== true) {
    return NextResponse.json({ stored, dropped: raw.length - sightings.length })
  }

  const picks = await candidates()
  const queued = await enqueue(picks, runId)
  const suggested = await suggest(picks.map((p) => p.post_id))
  const [spread] = await multiplierSpread()

  const stats = body.stats && typeof body.stats === 'object' ? body.stats : {}
  const started = typeof body.started_at === 'string' ? body.started_at : new Date().toISOString()
  const cost = Number(stats.cost_usd)
  await sql.query(
    `insert into transcriber.scout_runs
       (id, started_at, handles, sightings, picked, suggested, gated, cost_usd, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (id) do update
        set finished_at = now(), picked = excluded.picked, suggested = excluded.suggested,
            notes = excluded.notes`,
    [
      runId,
      started,
      Number(stats.handles) || 0,
      Number(stats.sightings) || 0,
      queued,
      suggested,
      Number(stats.gated) || 0,
      Number.isFinite(cost) ? cost : null,
      JSON.stringify({ spread, errors: stats.errors ?? [], skipped: stats.skipped ?? [] }),
    ],
  )

  return NextResponse.json({
    stored,
    dropped: raw.length - sightings.length,
    picked: picks.length,
    queued,
    suggested,
    spread,
    picks: picks.map((p) => ({ url: p.url, handle: p.handle, multiplier: p.multiplier, basis: p.basis })),
  })
}
