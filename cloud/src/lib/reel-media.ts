/**
 * What a reel looks like, for the video carousels on a model's profile
 * (2026-09-27: "all this text is overwhelming — put the videos there").
 *
 * The cover prefers the library's own thumbnail (served by /api/thumb, always
 * there once the Mac has the reel) over Instagram's poster link, which expires.
 * The video plays from Instagram's link while it lives; otherwise the card
 * opens the reel on Instagram.
 */
import { sql } from './db'
import { jobsForPosts } from './hers'
import { linksFor, mediaBase } from './media'

export type ReelMedia = {
  code: string
  handle: string | null
  poster: string | null
  video: string | null
  plays: number | null
  likes: number | null
  comments: number | null
  posted_at: string | null
  job_id: string | null
  /** The file itself, off the Mac, for the batcher — null when the Mac has none. */
  download: string | null
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function mediaForPosts(codes: string[]): Promise<Record<string, ReelMedia>> {
  const unique = [...new Set(codes.filter(Boolean))].slice(0, 200)
  if (!unique.length) return {}
  const [posts, jobs] = await Promise.all([
    sql.query(
      `select post_id, handle, poster_url, plays, likes, comments, posted_at,
              case when media_until > now() then video_url end as video_url
         from transcriber.creator_posts where post_id = any($1::text[])`,
      [unique],
    ),
    jobsForPosts(unique),
  ])
  const jobIds = [...jobs.values()]
  const rows = jobIds.length
    ? await sql.query(
        `select job_id, folder, (thumbnail is not null) as has_thumb
           from transcriber.transcripts where job_id = any($1::text[])`,
        [jobIds],
      )
    : []
  const thumbs = new Set(rows.filter((r) => r.has_thumb).map((r) => String(r.job_id)))
  const folders = new Map(rows.filter((r) => r.folder).map((r) => [String(r.job_id), String(r.folder)]))
  // The Mac's copy plays when Instagram's link has expired — only while the
  // Mac is awake, which is also the only time it can serve the file.
  const base = folders.size ? await mediaBase() : null
  const mac = (job: string | null) => (base && job && folders.has(job) ? linksFor(base, folders.get(job) as string) : null)
  const byCode = new Map(posts.map((p) => [String(p.post_id), p]))
  return Object.fromEntries(unique.map((code) => {
    const p = byCode.get(code)
    const job = jobs.get(code) ?? null
    return [code, {
      code,
      handle: p?.handle ? String(p.handle) : null,
      poster: job && thumbs.has(job) ? `/api/thumb/${job}` : p?.poster_url ? String(p.poster_url) : null,
      video: p?.video_url ? String(p.video_url) : mac(job)?.video ?? null,
      plays: num(p?.plays),
      likes: num(p?.likes),
      comments: num(p?.comments),
      posted_at: p?.posted_at ? new Date(String(p.posted_at)).toISOString() : null,
      job_id: job,
      download: mac(job)?.download ?? null,
    }]
  }))
}

/**
 * A face for a creator — the cover of their best reel in the library — and
 * an example cover for a format. Nothing stores profile photos, and this is
 * the picture we can always serve.
 */
export async function facesFor(handles: string[], formats: string[]) {
  const hs = [...new Set(handles.map((h) => h.toLowerCase()).filter(Boolean))].slice(0, 60)
  const fs = [...new Set(formats.filter(Boolean))].slice(0, 30)
  const [byHandle, byFormat] = await Promise.all([
    hs.length ? sql.query(
      `select distinct on (lower(t.author)) lower(t.author) as handle, t.job_id, c.followers
         from transcriber.transcripts t
         join transcriber.jobs j on j.id = t.job_id and j.status = 'done'
         left join transcriber.creators c on c.handle = lower(t.author)
        where lower(t.author) = any($1::text[]) and t.thumbnail is not null
        order by lower(t.author), t.like_count desc nulls last`,
      [hs],
    ) : Promise.resolve([]),
    fs.length ? sql.query(
      `select distinct on (g.tag) g.tag as format, t.job_id, t.author
         from transcriber.tags g
         join transcriber.transcripts t on t.job_id = g.job_id and t.thumbnail is not null
         join transcriber.jobs j on j.id = t.job_id and j.status = 'done' and j.archived_at is null
        where g.axis = 'format' and g.tag = any($1::text[])
        order by g.tag, t.like_count desc nulls last`,
      [fs],
    ) : Promise.resolve([]),
  ])
  return {
    handles: Object.fromEntries(byHandle.map((r) => [String(r.handle), {
      thumb: `/api/thumb/${String(r.job_id)}`,
      followers: r.followers === null || r.followers === undefined ? null : Number(r.followers),
    }])),
    formats: Object.fromEntries(byFormat.map((r) => [String(r.format), {
      thumb: `/api/thumb/${String(r.job_id)}`,
      author: r.author ? String(r.author) : null,
    }])),
  }
}
