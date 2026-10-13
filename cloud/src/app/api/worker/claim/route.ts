import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { jobMatchesCode } from '@/lib/sql'
import { expiredObjects, orphanedKeys, pendingUploads } from '@/lib/r2queue'

// A job still 'running' after this long means the worker died mid-transcribe.
const STALE_MINUTES = 30
const MAX_ATTEMPTS = 3
// How long a claim may be held open waiting for work (long-poll). A link
// pasted in the browser is then picked up within about a second, and the idle
// worker stops hammering this route — one held request replaces a poll every
// few seconds. The worker's own timeout is 60s, and the worker pings again the
// moment this returns, so 25s keeps it well inside the 90s online window.
const MAX_WAIT_SEC = 30
const HOLD_STEP_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const maxDuration = 60

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { limit = 1, note, wait_sec } = await request.json().catch(() => ({}))
  const waitMs = Math.min(Math.max(Number(wait_sec) || 0, 0), MAX_WAIT_SEC) * 1000
  const take = Math.min(Math.max(Number(limit) || 1, 1), 10)

  // The heartbeat, the stale sweep and the R2 errands are all independent of
  // the claim itself. Neon pays a round trip per query, so they run alongside
  // the sweep→claim critical path instead of queuing up behind it: a paste is
  // then picked up in well under a second rather than after six round trips.
  const pingPromise = sql.query(
    `insert into transcriber.worker_pings (id, seen_at, note) values (1, now(), $1)
     on conflict (id) do update set seen_at = now(), note = excluded.note`,
    [typeof note === 'string' ? note.slice(0, 200) : null],
  )
  void pingPromise.catch(() => {})

  // Anything abandoned mid-flight goes back in the queue, unless it has already
  // failed its way through the retry budget. This one must land before the
  // claim, or a stale job waits a whole hold cycle to be retried.
  await sql.query(
    `update transcriber.jobs
        set status = case when attempts >= $1 then 'failed' else 'queued' end,
            error  = case when attempts >= $1
                          then 'gave up after ' || attempts || ' interrupted attempts'
                          else error end,
            stage = null, claimed_at = null, updated_at = now()
      where status = 'running'
        and claimed_at < now() - interval '${STALE_MINUTES} minutes'`,
    [MAX_ATTEMPTS],
  )

  const errandsPromise = Promise.all([pendingUploads(), expiredObjects(), orphanedKeys()])
  void errandsPromise.catch(() => {})

  const claimOnce = () =>
    sql.query(
      `update transcriber.jobs j
          set status = 'running', stage = 'starting', claimed_at = now(),
              updated_at = now(), attempts = j.attempts + 1
         from (
           select id from transcriber.jobs
            where status = 'queued'
            order by created_at
            limit $1
            for update skip locked
         ) picked
        where j.id = picked.id
        returning j.id, j.kind, j.source, j.label, j.transcribe`,
      [take],
    )

  // Long-poll: hold the request while there is nothing to do, hand the job
  // over the instant one arrives. wait_sec = 0 keeps the old one-shot claim.
  const deadline = Date.now() + waitMs
  let claimed = await claimOnce()
  while (!claimed.length && Date.now() < deadline) {
    await sleep(HOLD_STEP_MS)
    claimed = await claimOnce()
  }

  await pingPromise

  // The media URL the sweep already read, handed over with the job.
  //
  // yt-dlp resolves an Instagram page through the private /api/v1 endpoints,
  // and those are retired — which is why every one of the 24 failed jobs on
  // 2026-09-20 came from the burner reader. But the sweep
  // that found the reel already saw `video_versions[0].url` and stored it, so
  // the Mac does not need to resolve anything: it can fetch the file. These
  // links expire, hence `media_until`.
  //
  // Both lookups run together for every claimed job — the direct sighting and
  // the by-shortcode fallback — and the direct row wins when both exist. One
  // round trip instead of two on the pickup path.
  const claimedIds = claimed.map((row) => String(row.id))
  const [direct, byCode] = claimedIds.length
    ? await Promise.all([
        sql.query(
          `select job_id, video_url, poster_url, caption, handle, posted_at, duration_sec
             from transcriber.sightings
            where job_id = any($1::text[])
              and video_url is not null
              and (media_until is null or media_until > now())`,
          [claimedIds],
        ),
        // Her own winners are queued straight into `jobs`, so no sighting is
        // linked to them. Match those by shortcode instead — a sighting of the
        // same reel, or the link the roster pass read off her own feed.
        // Without this, every winner Instagram would not let yt-dlp resolve
        // failed with nothing to fall back on: 12 of 62 on 2026-09-21.
        sql.query(
          `select distinct on (j.id) j.id as job_id, m.video_url, m.poster_url, m.caption,
                  m.handle, m.posted_at, m.duration_sec
             from transcriber.jobs j
             join (
               -- What the viewer burner saw on the reel's own page, keyed by the
               -- job, so it matches whatever the reel's shortcode.
               -- Named, every one: a union takes its column names from this
               -- first branch, and unnamed nulls here broke every claim with
               -- "column m.caption does not exist" (2026-09-25).
               select substring(jj.source from '/(?:reels?|p)/([A-Za-z0-9_-]+)') as post_id,
                      jm.video_url, jm.poster_url, null::text as caption, null::text as handle,
                      null::timestamptz as posted_at, null::real as duration_sec, jm.media_until
                 from transcriber.job_media jm join transcriber.jobs jj on jj.id = jm.job_id
               union all
               select post_id, video_url, poster_url, caption, handle, posted_at,
                      duration_sec, media_until
                 from transcriber.sightings
               union all
               select post_id, video_url, poster_url, caption, handle, posted_at,
                      null::real, media_until
                 from transcriber.creator_posts
             ) m on ${jobMatchesCode('j.source', 'm.post_id')}
            where j.id = any($1::text[])
              and m.video_url is not null
              and m.media_until > now()
            order by j.id, m.media_until desc`,
          [claimedIds],
        ),
      ])
    : [[], []]
  // byCode first so a direct sighting overwrites it when both matched.
  const media = Object.fromEntries([...byCode, ...direct].map((row) => [String(row.job_id), row]))

  // Plan videos ride along on the same poll: the Mac holds both the files and
  // the R2 credentials, so it is the only side that can move or reclaim bytes.
  const [uploads, expired, trash] = await errandsPromise
  return NextResponse.json({
    jobs: claimed.map((row) => ({ ...row, media: media[String(row.id)] ?? null })),
    uploads,
    expired,
    trash,
  })
}
