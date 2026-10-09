import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { presignGet, r2Config } from '@/lib/r2'

/**
 * The three platform feeds, served from `transcriber.ofmpro_media`.
 *
 * Same JSON shape the trimmed exports under public had, so the feeds and the
 * plan picker read it unchanged. One difference: a row whose video the worker
 * has mirrored to R2 streams from R2 (a fresh presigned link minted per
 * payload) instead of a CDN signature that expired days ago.
 */

const PLATFORMS = new Set(['instagram', 'tiktok', 'twitter'])

export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { platform } = await params
  if (!PLATFORMS.has(platform)) return NextResponse.json({ error: 'unknown platform' }, { status: 404 })

  const rows = await sql.query(
    `select media_id, shortcode, post_url, posted_at, caption, media_type, slides,
            view_count, like_count, comment_count, score, username, nickname, followers,
            audio, raw_url, mirror_url, r2_key,
            to_char((min(posted_at) over ())::date, 'YYYY-MM-DD') as win_from,
            to_char((max(posted_at) over ())::date, 'YYYY-MM-DD') as win_to
       from transcriber.ofmpro_media
      where platform = $1
      order by score desc nulls last, posted_at desc`,
    [platform],
  )

  const config = r2Config()
  const mirrored = (key: unknown): string | null =>
    config && typeof key === 'string' && key.length > 0 ? presignGet(config, key) : null

  const items = rows.map((row) => {
    const picture = row.media_type === 'IMAGE' || row.media_type === 'SLIDESHOW'
    const r2 = mirrored(row.r2_key)
    return {
      id: String(row.media_id),
      shortcode: (row.shortcode as string | null) ?? null,
      url: (row.post_url as string | null) ?? null,
      created: row.posted_at ? new Date(String(row.posted_at)).toISOString() : null,
      caption: (row.caption as string | null) ?? null,
      type: (row.media_type as string | null) ?? null,
      views: Number(row.view_count ?? 0),
      likes: Number(row.like_count ?? 0),
      comments: Number(row.comment_count ?? 0),
      score: row.score === null || row.score === undefined ? null : Number(row.score),
      username: (row.username as string | null) ?? null,
      nickname: (row.nickname as string | null) ?? null,
      followers: row.followers === null || row.followers === undefined ? null : Number(row.followers),
      audio: (row.audio as string | null) ?? null,
      video: picture ? null : r2 ?? (row.raw_url as string | null) ?? null,
      image: picture ? r2 ?? (row.raw_url as string | null) ?? null : null,
      slides: row.slides === null || row.slides === undefined ? null : Number(row.slides),
      mirror: (row.mirror_url as string | null) ?? null,
    }
  })

  const totals = {
    views: items.reduce((sum, item) => sum + item.views, 0),
    likes: items.reduce((sum, item) => sum + item.likes, 0),
    comments: items.reduce((sum, item) => sum + item.comments, 0),
    creators: new Set(items.map((item) => item.username).filter(Boolean)).size,
    scored: items.filter((item) => item.score !== null).length,
  }

  return NextResponse.json(
    {
      platform,
      window: { from: (rows[0]?.win_from as string | null) ?? null, to: (rows[0]?.win_to as string | null) ?? null },
      // The old exports counted retrieved rows and merged duplicate copies;
      // one row per media id is now the only truth, so rows and unique are the
      // same number and duplicates is zero by construction.
      rows: items.length,
      unique: items.length,
      duplicates: 0,
      totals,
      items,
    },
    // The worker lands new rows a few times a day; a minute of browser cache
    // keeps the feeds from re-downloading a megabyte on every tab switch.
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
