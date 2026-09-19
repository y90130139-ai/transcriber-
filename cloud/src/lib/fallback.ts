/**
 * What runs when the Mac does not.
 *
 * The Mac is the real worker: it fetches, transcribes with whisper.cpp on the
 * GPU, reads on-screen text with Apple's Vision framework, diarizes, and
 * uploads a plan's videos to R2. None of that can move to a serverless
 * function. But a Mac Mini that dies on a Tuesday should not stop the models
 * getting their week, so this stands in for the two things that matter:
 *
 *   1. queued reels get a transcript, so the library keeps filling;
 *   2. plan videos reach R2, so a creator's page still plays.
 *
 * It is deliberately less than the Mac: no diarization, no on-screen text, no
 * local copy of the video. Those rows can be finished properly when the Mac
 * comes back (`has_looked` stays null, which is exactly the "nothing has
 * looked" state `relook` already hunts for).
 *
 * Nothing here runs while the Mac is alive. The heartbeat it already writes on
 * every poll is the switch.
 */
import { sql } from './db'
import { cloudUploads, recordUploaded } from './r2queue'
import { presign, r2Config } from './r2'
import { transcribe, sttConfigured, MAX_AUDIO_BYTES } from './stt'

/** How long the Mac must be silent before the cloud steps in. It pings every
 *  30 seconds, so ninety minutes is unambiguous: asleep, off, or gone —
 *  never "between jobs". */
export const STALE_AFTER_MIN = 90

/** Work per invocation. A serverless function has 60 seconds; a reel's audio
 *  is small and turbo is quick, but leave room to finish cleanly. */
const JOBS_PER_RUN = 5
const UPLOADS_PER_RUN = 3
const TIME_BUDGET_MS = 42_000

export type MacState = { seenAgoMin: number | null; stale: boolean; note: string | null }

export async function macState(): Promise<MacState> {
  const [ping] = await sql.query(
    `select note, extract(epoch from (now() - seen_at)) / 60 as ago
       from transcriber.worker_pings where id = 1`,
  )
  if (!ping) return { seenAgoMin: null, stale: true, note: null }
  const ago = Number(ping.ago)
  return {
    seenAgoMin: Math.round(ago),
    stale: ago >= STALE_AFTER_MIN,
    note: ping.note ? String(ping.note) : null,
  }
}

type Claimable = {
  job_id: string
  post_id: string
  handle: string
  url: string
  audio_url: string
  poster_url: string | null
  caption: string | null
  posted_at: string | null
  duration_sec: number | null
  plays: number | null
  likes: number | null
  comments: number | null
}

/** Queued reels the cloud can actually do something with: a live CDN link to
 *  their audio. Anything else waits for the Mac. */
async function claimable(limit: number): Promise<Claimable[]> {
  const rows = await sql.query(
    `select j.id as job_id, s.post_id, s.handle, s.url, s.audio_url, s.poster_url,
            s.caption, s.posted_at, s.duration_sec, s.plays, s.likes, s.comments
       from transcriber.jobs j
       join transcriber.sightings s on s.source_key = j.source_key
      where j.status = 'queued'
        and s.audio_url is not null
        and s.media_until > now()
      order by j.created_at
      limit $1`,
    [limit],
  )
  return rows as unknown as Claimable[]
}

/** The payload the Mac would have posted. Written through the same route, so
 *  tagging, dedupe and creator upkeep all happen exactly as they always do. */
function completionFor(job: Claimable, heard: { text: string; words: number; language: string | null; seconds: number | null; voiced: number | null }, thumbnail: string | null) {
  const spoke = heard.words > 0
  return {
    id: job.job_id,
    platform: 'instagram',
    author: job.handle,
    author_name: job.handle,
    title: `Video by ${job.handle}`,
    webpage_url: job.url,
    caption: job.caption,
    upload_date: job.posted_at ? String(job.posted_at).slice(0, 10) : null,
    duration_sec: job.duration_sec,
    language: heard.language,
    // No diarization here: one unnamed voice is a claim we can defend, a
    // speaker count is not.
    speaker_count: null,
    word_count: heard.words,
    thumbnail,
    plain: spoke ? heard.text : '\n',
    markdown: spoke ? heard.text : '',
    srt: null,
    blocks: null,
    speakers: null,
    folder: null,
    post_id: job.post_id,
    like_count: job.likes,
    comment_count: job.comments,
    has_speech: spoke,
    speech_ratio:
      heard.seconds && heard.voiced !== null && heard.seconds > 0
        ? Math.min(1, heard.voiced / heard.seconds)
        : null,
    // Left null on purpose: nothing has looked at the pixels. `relook` finds
    // exactly this state when the Mac is back.
    has_looked: null,
    on_screen_text: null,
    on_screen_captions: null,
  }
}

/** The poster frame, if it is small enough to inline. The Mac downsizes to
 *  420px; here there is no image library, so a big one is simply skipped and
 *  the card shows without art rather than carrying a megabyte of base64. */
const MAX_POSTER_BYTES = 120 * 1024

async function posterFor(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? 'image/jpeg'
    if (!type.startsWith('image/')) return null
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_POSTER_BYTES) return null
    return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
  } catch {
    return null
  }
}

async function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WORKER_SECRET ?? ''}`,
    },
    body: JSON.stringify(body),
  })
}

export type FallbackResult = {
  transcribed: number
  failed: number
  uploaded: number
  remaining: number
  errors: string[]
}

/** One pass of standing in for the Mac. */
export async function runFallback(origin: string): Promise<FallbackResult> {
  const deadline = Date.now() + TIME_BUDGET_MS
  const result: FallbackResult = { transcribed: 0, failed: 0, uploaded: 0, remaining: 0, errors: [] }

  if (sttConfigured()) {
    for (const job of await claimable(JOBS_PER_RUN)) {
      if (Date.now() > deadline) break
      // Claim it first: two overlapping invocations must not both pay to
      // transcribe the same reel.
      const [claimed] = await sql.query(
        `update transcriber.jobs set status = 'running', stage = 'cloud', claimed_at = now(),
                attempts = attempts + 1, updated_at = now()
          where id = $1 and status = 'queued'
          returning id`,
        [job.job_id],
      )
      if (!claimed) continue

      try {
        const audio = await fetch(job.audio_url)
        if (!audio.ok) throw new Error(`audio ${audio.status}`)
        const bytes = await audio.arrayBuffer()
        if (bytes.byteLength > MAX_AUDIO_BYTES) throw new Error('audio too large')
        const heard = await transcribe(bytes)
        const thumbnail = await posterFor(job.poster_url)
        const done = await post(origin, '/api/worker/complete', completionFor(job, heard, thumbnail))
        if (!done.ok) throw new Error(`complete ${done.status}: ${(await done.text()).slice(0, 120)}`)
        result.transcribed += 1
      } catch (error) {
        result.failed += 1
        result.errors.push(`${job.post_id}: ${String(error).slice(0, 160)}`)
        await post(origin, '/api/worker/fail', { id: job.job_id, error: `cloud: ${String(error).slice(0, 200)}` })
      }
    }
  } else {
    result.errors.push('no CLOUDFLARE_AI_TOKEN — cloud transcription is off')
  }

  // Plan videos: a creator's page playing is worth more than a transcript.
  const config = r2Config()
  if (config) {
    for (const upload of (await cloudUploads()).slice(0, UPLOADS_PER_RUN)) {
      if (Date.now() > deadline) break
      try {
        const video = await fetch(upload.url)
        if (!video.ok) throw new Error(`video ${video.status}`)
        const bytes = await video.arrayBuffer()
        const put = await fetch(presign(config, upload.key, { method: 'PUT', ttlSec: 600 }), {
          method: 'PUT',
          body: bytes,
          headers: { 'Content-Type': 'video/mp4' },
        })
        if (!put.ok) throw new Error(`r2 ${put.status}`)
        await recordUploaded(upload.id, upload.key, bytes.byteLength)
        result.uploaded += 1
      } catch (error) {
        result.errors.push(`upload ${upload.id}: ${String(error).slice(0, 160)}`)
      }
    }
  }

  const [{ left }] = await sql.query(
    `select count(*)::int as left
       from transcriber.jobs j
       join transcriber.sightings s on s.source_key = j.source_key
      where j.status = 'queued' and s.audio_url is not null and s.media_until > now()`,
  )
  result.remaining = Number(left)
  return result
}
