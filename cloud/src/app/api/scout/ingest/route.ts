import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { requeueWithFreshLinks } from '@/lib/hers'
import {
  candidates,
  enqueue,
  multiplierSpread,
  PICK_WINDOW_DAYS,
  parseAccess,
  parseCreatorPost,
  parseCreatorSnapshot,
  parseSighting,
  storeAccess,
  storeCreatorPosts,
  storeCreatorSnapshots,
  storeSightings,
  suggest,
  type Access,
  type CreatorPost,
  type CreatorSnapshot,
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

  // The cadence record travels on the same chunk. It is a different question
  // from scoring — every post type, not just the reels that can win — so it is
  // parsed and stored separately rather than folded into `sightings`.
  const posts = (Array.isArray(body.posts) ? body.posts : [])
    .map(parseCreatorPost)
    .filter((p: CreatorPost | null): p is CreatorPost => p !== null)
  const snapshots = (Array.isArray(body.snapshots) ? body.snapshots : [])
    .map(parseCreatorSnapshot)
    .filter((s: CreatorSnapshot | null): s is CreatorSnapshot => s !== null)

  const stored = await storeSightings(sightings)
  await storeAccess(access, swept)
  const postsStored = await storeCreatorPosts(posts)
  const snapsStored = await storeCreatorSnapshots(snapshots)
  // Roster rows and Scout sightings can each carry a fresh Instagram CDN URL.
  // If a failed winner gets one, requeue it without waiting for a manual retry.
  const hasFreshVideo = posts.some((post: CreatorPost) => post.video_url)
    || sightings.some((sighting: Sighting) => sighting.video_url)
  const requeued = hasFreshVideo ? await requeueWithFreshLinks() : 0

  if (body.final !== true) {
    return NextResponse.json({
      stored, dropped: raw.length - sightings.length,
      posts: postsStored, snapshots: snapsStored, requeued,
    })
  }

  // A header-only pass must never pick old sightings and masquerade as a
  // fresh content sweep. Older workers did not send kind; infer those passes
  // from their snapshots/statistics so they remain compatible during rollout.
  const stats = body.stats && typeof body.stats === 'object' ? body.stats : {}
  const profilesOnly = body.kind === 'profiles'
    || (body.kind !== 'sweep' && sightings.length === 0 && snapshots.length > 0 && !Number(stats.sightings))
  const picks = profilesOnly ? [] : await candidates()
  const queued = await enqueue(picks, runId)
  const suggested = await suggest(picks.map((p) => p.post_id))
  const [spread] = await multiplierSpread()

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
      JSON.stringify({ kind: profilesOnly ? 'profiles' : 'sweep', spread,
        errors: stats.errors ?? [], skipped: stats.skipped ?? [], window_days: profilesOnly ? null : PICK_WINDOW_DAYS }),
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
