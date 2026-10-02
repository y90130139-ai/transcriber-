import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { VIEW_TRIES } from '@/lib/queue-state'

/**
 * The viewer burner's side of the queue (src/viewer.py on the Mac).
 *
 * Some reels Instagram shows only to signed-in accounts. Until 2026-09-25 the
 * downloader reached them with Geno's own account's cookie, and Instagram
 * warned that account for automated behaviour. Now a dedicated burner opens
 * each one in a real browser, at a person's pace, and reports the video link
 * the page itself loaded. The worker fetches the file from that link with no
 * account attached.
 *
 * GET  → reels the downloader could not fetch, oldest first, skipping
 *        any the viewer has tried recently or given up on.
 * POST → { job_id, video_url?, poster_url?, error? } — one reel seen. With a
 *        link, the job goes back in the queue; with an error, the try is
 *        counted and the reel rests.
 */

/** Every reel yt-dlp could not fetch. Not just the ones hidden from
 *  logged-out visitors: while Geno's account was being flagged, 21 more came
 *  back as "an empty media response" or JSON that would not parse — Instagram
 *  throttling a tool, which a real browser gets past. A reel that is really
 *  gone just finds no link and rests after MAX_TRIES. */
const GATED = `error like 'could not download%'`
/** A reel the viewer could not read gets this many tries, a day apart. */
const MAX_TRIES = VIEW_TRIES
const LIMIT = 20

export async function GET(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await sql.query(
    `select j.id, j.source
       from transcriber.jobs j
       left join transcriber.job_media m on m.job_id = j.id
      where j.status = 'failed'
        and j.source ~ '/(reels?|p)/[A-Za-z0-9_-]+'
        and ${GATED}
        and coalesce(m.tries, 0) < $1
        and (m.viewed_at is null or m.viewed_at < now() - interval '1 day')
      order by j.created_at
      limit $2`,
    [MAX_TRIES, LIMIT],
  )
  return NextResponse.json({ jobs: rows.map((r) => ({ id: String(r.id), source: String(r.source) })) })
}

/** Instagram's CDN links carry their own expiry as `oe=<hex seconds>`. */
function expiryOf(url: string): string | null {
  const match = /[?&]oe=([0-9a-fA-F]{6,10})/.exec(url)
  if (!match) return null
  const seconds = parseInt(match[1], 16)
  return Number.isFinite(seconds) && seconds > 1_600_000_000 ? new Date(seconds * 1000).toISOString() : null
}

const isCdn = (value: unknown): value is string =>
  typeof value === 'string' && /^https:\/\/[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net)\//i.test(value)

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const jobId = typeof body?.job_id === 'string' ? body.job_id : null
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 })

  // Only Instagram's own video servers: whatever the page claims, this link is
  // later fetched by the Mac, so it must not be able to point anywhere else.
  const video = isCdn(body.video_url) ? body.video_url : null
  const poster = isCdn(body.poster_url) ? body.poster_url : null
  const error = typeof body.error === 'string' ? body.error.slice(0, 300) : null
  const until = video ? expiryOf(video) ?? new Date(Date.now() + 12 * 3600_000).toISOString() : null

  await sql.query(
    `insert into transcriber.job_media (job_id, video_url, poster_url, media_until, viewed_at, tries, last_error)
     values ($1, $2, $3, $4, now(), 1, $5)
     on conflict (job_id) do update set
       video_url = coalesce(excluded.video_url, transcriber.job_media.video_url),
       poster_url = coalesce(excluded.poster_url, transcriber.job_media.poster_url),
       media_until = coalesce(excluded.media_until, transcriber.job_media.media_until),
       viewed_at = now(),
       tries = transcriber.job_media.tries + 1,
       last_error = excluded.last_error`,
    [jobId, video, poster, until, video ? null : error ?? 'no video on the page'],
  )
  let requeued = false
  if (video) {
    const rows = await sql.query(
      `update transcriber.jobs set status = 'queued', error = null, stage = null, attempts = 0,
              claimed_at = null, updated_at = now()
        where id = $1 and status = 'failed' returning id`,
      [jobId],
    )
    requeued = rows.length > 0
  }
  return NextResponse.json({ ok: true, requeued })
}
