import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { redraftForJob } from '@/lib/models'
import { autoTag } from '@/lib/tagging'

/** The Mac posts a finished transcript here and the job closes out. */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => null)
  if (!payload?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const text = (value: unknown, limit = 200_000) =>
    typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : null
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  // The last line of defence against the same post arriving twice. Link
  // normalisation catches the shapes we know about (www, http, /p/ vs /reel/,
  // share tracking), but a redirect, a re-upload of the same clip as a file, or
  // a URL shape nobody has met yet still lands here as a second job. Two rows
  // for one post is not merely untidy: `hot.ts` divides a post's score by its
  // creator's median, so a phantom copy quietly moves that median and changes
  // which of their posts read as hot.
  //
  // Only the post id decides this — it comes from the platform, after the fetch,
  // so it is the same string however the link was written. A job already on a
  // model's plan is kept regardless; nothing that someone is working from
  // should vanish under them.
  const postId = text(payload.post_id, 100)
  if (postId) {
    const [twin] = await sql.query(
      `select t.job_id from transcriber.transcripts t
        where t.post_id = $1 and t.job_id <> $2
          and not exists (select 1 from transcriber.plan_items i where i.job_id = $2)
        limit 1`,
      [postId, payload.id],
    )
    if (twin) {
      await sql.query(`delete from transcriber.jobs where id = $1`, [payload.id])
      return NextResponse.json({ ok: true, duplicate_of: twin.job_id })
    }
  }

  await sql.query(
    `insert into transcriber.transcripts (
       job_id, platform, author, author_name, title, webpage_url, caption,
       upload_date, duration_sec, language, speaker_count, word_count,
       thumbnail, plain, markdown, srt, blocks, speakers, transcribed_at,
       folder, post_id, like_count, comment_count, has_speech, speech_ratio,
       has_looked, on_screen_text, on_screen_captions
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       coalesce($14,''), coalesce($15,''), $16, $17, $18, now(),
       $19, $20, $21, $22, $23::boolean, $24::real,
       $25::boolean, $26::text, $27::jsonb
     )
     on conflict (job_id) do update set
       platform = excluded.platform, author = excluded.author,
       author_name = excluded.author_name, title = excluded.title,
       webpage_url = excluded.webpage_url, caption = excluded.caption,
       upload_date = excluded.upload_date, duration_sec = excluded.duration_sec,
       language = excluded.language, speaker_count = excluded.speaker_count,
       word_count = excluded.word_count, thumbnail = excluded.thumbnail,
       plain = excluded.plain, markdown = excluded.markdown, srt = excluded.srt,
       blocks = excluded.blocks, speakers = excluded.speakers,
       transcribed_at = now(), folder = excluded.folder, post_id = excluded.post_id,
       like_count = excluded.like_count, comment_count = excluded.comment_count,
       -- A rerun that skipped the audio must not erase what an earlier pass heard.
       has_speech = coalesce(excluded.has_speech, transcriber.transcripts.has_speech),
       speech_ratio = coalesce(excluded.speech_ratio, transcriber.transcripts.speech_ratio),
       -- Same rule for the screen: a rerun that skipped the visual pass must
       -- not erase what an earlier pass read.
       has_looked = coalesce(excluded.has_looked, transcriber.transcripts.has_looked),
       on_screen_text = coalesce(excluded.on_screen_text, transcriber.transcripts.on_screen_text),
       on_screen_captions = coalesce(excluded.on_screen_captions, transcriber.transcripts.on_screen_captions)`,
    [
      payload.id,
      text(payload.platform, 40),
      text(payload.author, 200),
      text(payload.author_name, 200),
      text(payload.title, 400),
      text(payload.webpage_url, 2000),
      text(payload.caption, 20_000),
      text(payload.upload_date, 20),
      number(payload.duration_sec),
      text(payload.language, 20),
      number(payload.speaker_count),
      number(payload.word_count),
      text(payload.thumbnail, 400_000),
      text(payload.plain),
      text(payload.markdown),
      text(payload.srt),
      JSON.stringify(payload.blocks ?? []),
      JSON.stringify(payload.speakers ?? []),
      text(payload.folder, 200),
      text(payload.post_id, 100),
      number(payload.like_count),
      number(payload.comment_count),
      typeof payload.has_speech === 'boolean' ? payload.has_speech : null,
      number(payload.speech_ratio),
      typeof payload.has_looked === 'boolean' ? payload.has_looked : null,
      text(payload.on_screen_text, 20_000),
      Array.isArray(payload.on_screen_captions) && payload.on_screen_captions.length
        ? JSON.stringify(payload.on_screen_captions)
        : null,
    ],
  )

  // The creator is a first-class thing here: the Models tab groups by handle,
  // and a persona confirmed once carries to everything they post afterwards.
  if (typeof payload.author === 'string' && payload.author.trim()) {
    await sql.query(
      `insert into transcriber.creators (handle, display_name)
       values ($1, $2)
       on conflict (handle) do update
          set display_name = coalesce(excluded.display_name, transcriber.creators.display_name),
              updated_at = now()`,
      [payload.author.slice(0, 200), text(payload.author_name, 200)],
    )
  }

  await sql.query(
    `update transcriber.jobs
        set status = 'done', stage = null, error = null, updated_at = now()
      where id = $1`,
    [payload.id],
  )

  // Pre-tag it now, while the transcript is fresh in the database. Suggestions
  // are cheap to correct and impossible to catch up on by hand later.
  await autoTag(payload.id).catch(() => {
    // A tagging miss must never fail a transcript that arrived intact.
  })

  // A thin card — a feed pick added to a week before this fetch — has no
  // direction yet. Now that the words, tags and screen reads exist, every
  // card for this job that is still the machine's (or blank) gets its drafted
  // brief. Written cards are left alone inside; see redraftForJob.
  await redraftForJob(String(payload.id)).catch(() => {
    // Same rule as tagging: this must never fail a transcript that landed.
  })

  return NextResponse.json({ ok: true })
}
