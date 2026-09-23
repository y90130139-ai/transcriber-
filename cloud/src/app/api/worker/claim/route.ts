import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { jobMatchesCode } from '@/lib/sql'
import { expiredObjects, orphanedKeys, pendingUploads } from '@/lib/r2queue'

// A job still 'running' after this long means the worker died mid-transcribe.
const STALE_MINUTES = 30
const MAX_ATTEMPTS = 3

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { limit = 1, note } = await request.json().catch(() => ({}))

  await sql.query(
    `insert into transcriber.worker_pings (id, seen_at, note) values (1, now(), $1)
     on conflict (id) do update set seen_at = now(), note = excluded.note`,
    [typeof note === 'string' ? note.slice(0, 200) : null],
  )

  // Anything abandoned mid-flight goes back in the queue, unless it has already
  // failed its way through the retry budget.
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

  const claimed = await sql.query(
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
    [Math.min(Math.max(Number(limit) || 1, 1), 10)],
  )

  // The media URL the sweep already read, handed over with the job.
  //
  // yt-dlp resolves an Instagram page through the private /api/v1 endpoints,
  // and those are retired — which is why every one of the 24 failed jobs on
  // 2026-09-20 came from the burner reader and none from Apify. But the sweep
  // that found the reel already saw `video_versions[0].url` and stored it, so
  // the Mac does not need to resolve anything: it can fetch the file. These
  // links expire, hence `media_until`.
  const direct = claimed.length
    ? await sql.query(
        `select job_id, video_url, poster_url, caption, handle, posted_at, duration_sec
           from transcriber.sightings
          where job_id = any($1::text[])
            and video_url is not null
            and (media_until is null or media_until > now())`,
        [claimed.map((row) => String(row.id))],
      )
    : []
  // Her own winners are queued straight into `jobs`, so no sighting is linked
  // to them. Match those by shortcode instead — a sighting of the same reel,
  // or the link the roster pass read off her own feed. Without this, every
  // winner Instagram would not let yt-dlp resolve failed with nothing to fall
  // back on: 12 of 62 on 2026-09-21.
  const linked = new Set(direct.map((row) => String(row.job_id)))
  const unlinked = claimed.filter((row) => !linked.has(String(row.id))).map((row) => String(row.id))
  const byCode = unlinked.length
    ? await sql.query(
        `select distinct on (j.id) j.id as job_id, m.video_url, m.poster_url, m.caption,
                m.handle, m.posted_at, m.duration_sec
           from transcriber.jobs j
           join (
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
        [unlinked],
      )
    : []
  const media = Object.fromEntries([...direct, ...byCode].map((row) => [String(row.job_id), row]))

  // Plan videos ride along on the same poll: the Mac holds both the files and
  // the R2 credentials, so it is the only side that can move or reclaim bytes.
  return NextResponse.json({
    jobs: claimed.map((row) => ({ ...row, media: media[String(row.id)] ?? null })),
    uploads: await pendingUploads(),
    expired: await expiredObjects(),
    trash: await orphanedKeys(),
  })
}
