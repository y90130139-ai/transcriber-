import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * The worker hands back one window's worth of OFMPro rows.
 *
 * The worker maps OFMPro's raw item shape to these rows itself (the same trim
 * `scripts/backfill-ofmpro.mjs` makes), so this route stays a plain upsert and
 * never needs to know what OFMPro renames next. A row that already exists is
 * refreshed; `raw_url`/`mirror_url` only ever fill holes, because a live URL
 * from an earlier run beats one that has already started expiring.
 *
 * Returns the rows this platform still has no R2 copy for, so the worker can
 * download and mirror them in the same pass.
 */

const MAX_ITEMS = 2000
const BATCH = 200
const RESP = new Set(['instagram', 'tiktok', 'twitter'])

type Item = Record<string, unknown>

const text = (value: unknown, limit = 20_000): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const platform = typeof body.platform === 'string' && RESP.has(body.platform) ? body.platform : null
  if (!platform) return NextResponse.json({ error: 'platform required' }, { status: 400 })
  const offered: Item[] = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
  if (offered.length === 0) return NextResponse.json({ inserted: 0, updated: 0, need: [] })

  const rows = offered
    .map((item) => ({
      platform,
      media_id: text(item.media_id, 64),
      shortcode: text(item.shortcode, 64),
      post_url: text(item.post_url, 2000),
      posted_at: text(item.posted_at, 40),
      caption: text(item.caption),
      media_type: text(item.media_type, 40),
      slides: num(item.slides),
      views: num(item.views) ?? 0,
      likes: num(item.likes) ?? 0,
      comments: num(item.comments) ?? 0,
      score: num(item.score),
      username: text(item.username, 200),
      nickname: text(item.nickname, 200),
      followers: num(item.followers),
      audio: text(item.audio, 500),
      raw_url: text(item.raw_url, 4000),
      mirror_url: text(item.mirror_url, 4000),
    }))
    .filter((row) => row.media_id)

  let inserted = 0
  let updated = 0
  for (let at = 0; at < rows.length; at += BATCH) {
    const chunk = rows.slice(at, at + BATCH)
    const values = chunk.map((_, index) => {
      const base = index * 18
      return `(${Array.from({ length: 18 }, (_, column) => `$${base + column + 1}`).join(',')})`
    })
    const params = chunk.flatMap((row) => [
      row.platform, row.media_id, row.shortcode, row.post_url, row.posted_at, row.caption,
      row.media_type, row.slides, row.views, row.likes, row.comments, row.score,
      row.username, row.nickname, row.followers, row.audio, row.raw_url, row.mirror_url,
    ])
    const done = await sql.query(
      `insert into transcriber.ofmpro_media
         (platform, media_id, shortcode, post_url, posted_at, caption, media_type, slides,
          view_count, like_count, comment_count, score, username, nickname, followers, audio,
          raw_url, mirror_url)
       values ${values.join(',')}
       on conflict (platform, media_id) do update set
         shortcode = coalesce(excluded.shortcode, transcriber.ofmpro_media.shortcode),
         post_url = coalesce(excluded.post_url, transcriber.ofmpro_media.post_url),
         posted_at = coalesce(excluded.posted_at, transcriber.ofmpro_media.posted_at),
         caption = coalesce(excluded.caption, transcriber.ofmpro_media.caption),
         media_type = coalesce(excluded.media_type, transcriber.ofmpro_media.media_type),
         slides = coalesce(excluded.slides, transcriber.ofmpro_media.slides),
         view_count = greatest(coalesce(excluded.view_count, 0), coalesce(transcriber.ofmpro_media.view_count, 0)),
         like_count = greatest(coalesce(excluded.like_count, 0), coalesce(transcriber.ofmpro_media.like_count, 0)),
         comment_count = greatest(coalesce(excluded.comment_count, 0), coalesce(transcriber.ofmpro_media.comment_count, 0)),
         score = coalesce(excluded.score, transcriber.ofmpro_media.score),
         username = coalesce(excluded.username, transcriber.ofmpro_media.username),
         nickname = coalesce(excluded.nickname, transcriber.ofmpro_media.nickname),
         followers = greatest(coalesce(excluded.followers, 0), coalesce(transcriber.ofmpro_media.followers, 0)),
         audio = coalesce(excluded.audio, transcriber.ofmpro_media.audio),
         raw_url = coalesce(excluded.raw_url, transcriber.ofmpro_media.raw_url),
         mirror_url = coalesce(excluded.mirror_url, transcriber.ofmpro_media.mirror_url),
         updated_at = now()
       returning (xmax = 0) as fresh`,
      params,
    )
    for (const row of done) {
      if (row.fresh) inserted += 1
      else updated += 1
    }
  }

  const need = await sql.query(
    `select platform, media_id, raw_url, mirror_url, media_type
       from transcriber.ofmpro_media
      where platform = $1 and r2_key is null and (raw_url is not null or mirror_url is not null)
        and media_id = any($2::text[])
      order by posted_at desc nulls last
      limit 60`,
    [platform, rows.map((row) => row.media_id as string)],
  )

  return NextResponse.json({ inserted, updated, need })
}
