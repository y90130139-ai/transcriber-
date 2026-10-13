import { NextResponse } from 'next/server'
import { isSignedIn, isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { ofmproR2Config, presignGet } from '@/lib/r2'

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

  const [rows, [tagged]] = await Promise.all([
    sql.query(
      `select media_id, shortcode, post_url, posted_at, caption, media_type, slides,
              view_count, like_count, comment_count, score, username, nickname, followers,
              audio, raw_url, mirror_url, r2_key,
              to_char((min(posted_at) over ())::date, 'YYYY-MM-DD') as win_from,
              to_char((max(posted_at) over ())::date, 'YYYY-MM-DD') as win_to
         from transcriber.ofmpro_media
        where platform = $1
          and unavailable_at is null
        order by score desc nulls last, posted_at desc`,
      [platform],
    ),
    sql.query(
      `select count(*)::int as unavailable
         from transcriber.ofmpro_media
        where platform = $1
          and unavailable_at is not null`,
      [platform],
    ),
  ])

  const config = ofmproR2Config()
  const mirrored = (key: unknown): string | null =>
    config && typeof key === 'string' && key.length > 0 ? presignGet(config, key) : null

  const items = rows.map((row) => {
    const picture = row.media_type === 'IMAGE' || row.media_type === 'SLIDESHOW'
    const hasR2Key = typeof row.r2_key === 'string' && row.r2_key.length > 0
    const r2 = mirrored(row.r2_key)
    const raw = (row.raw_url as string | null) ?? null
    const sourceMirror = (row.mirror_url as string | null) ?? null
    const primary = hasR2Key ? r2 : raw ?? sourceMirror
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
      video: picture ? null : primary,
      image: picture ? primary : null,
      slides: row.slides === null || row.slides === undefined ? null : Number(row.slides),
      // A saved row uses Cloudflare as its primary URL. The source URL is only
      // a recovery attempt if that saved copy cannot be played.
      mirror: hasR2Key ? r2 : sourceMirror,
      fallback: hasR2Key ? raw ?? sourceMirror : sourceMirror,
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
      unavailable: Number(tagged?.unavailable ?? 0),
      totals,
      items,
    },
    // The worker lands new rows a few times a day; a minute of browser cache
    // keeps the feeds from re-downloading a megabyte on every tab switch.
    { headers: { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' } },
  )
}

type ProbeResult = 'available' | 'unavailable' | 'unknown'

async function probeMedia(url: string, platform: string): Promise<ProbeResult> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return 'unavailable'
    const headers = new Headers({
      Range: 'bytes=0-0',
      'User-Agent': 'Mozilla/5.0 (compatible; TranscriberMediaCheck/1.0)',
    })
    if (platform !== 'twitter') headers.set('Referer', 'https://app.ofmpro.com/')
    const response = await fetch(parsed, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    try { await response.body?.cancel() } catch { /* the probe does not need the body */ }
    if (response.status >= 200 && response.status < 300) return 'available'
    if ([401, 403, 404, 410].includes(response.status)) return 'unavailable'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Mark a preview the player could not open. No probe, no delete — scrolling
 *  stays on the feed instead of waiting on a database cleanup. */
export async function PATCH(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await isSignedIn()) && !isWorker(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { platform } = await params
  if (!PLATFORMS.has(platform)) return NextResponse.json({ error: 'unknown platform' }, { status: 404 })

  const body = await request.json().catch(() => null) as { mediaId?: unknown } | null
  const mediaId = typeof body?.mediaId === 'string' ? body.mediaId.trim() : ''
  if (!mediaId || mediaId.length > 256) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })
  }

  const tagged = await sql.query(
    `update transcriber.ofmpro_media
        set unavailable_at = coalesce(unavailable_at, now()),
            updated_at = now()
      where platform = $1 and media_id = $2
      returning media_id`,
    [platform, mediaId],
  )
  return NextResponse.json({ tagged: tagged.length > 0 })
}

/** Remove a row only after its saved R2 copy and every recorded source fail a
 *  small range probe. Transient/ambiguous network failures are retained.
 *  `?unavailable=1` is the explicit purge of rows already tagged unavailable. */
export async function DELETE(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await isSignedIn()) && !isWorker(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { platform } = await params
  if (!PLATFORMS.has(platform)) return NextResponse.json({ error: 'unknown platform' }, { status: 404 })

  const url = new URL(request.url)
  if (url.searchParams.get('unavailable') === '1') {
    const deleted = await sql.query(
      `delete from transcriber.ofmpro_media
        where platform = $1 and unavailable_at is not null
        returning media_id`,
      [platform],
    )
    return NextResponse.json({ deleted: deleted.length })
  }

  const mediaId = url.searchParams.get('mediaId')?.trim()
  if (!mediaId || mediaId.length > 256) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })
  }

  const [row] = await sql.query(
    `select raw_url, mirror_url, r2_key
       from transcriber.ofmpro_media
      where platform = $1 and media_id = $2
      limit 1`,
    [platform, mediaId],
  )
  if (!row) return NextResponse.json({ deleted: false, reason: 'not_found' }, { status: 404 })

  const sources = new Set<string>()
  if (typeof row.r2_key === 'string' && row.r2_key) {
    const config = ofmproR2Config()
    if (!config) {
      return NextResponse.json({ deleted: false, reason: 'r2_unconfigured' }, { status: 503 })
    }
    sources.add(presignGet(config, row.r2_key))
  }
  for (const value of [row.raw_url, row.mirror_url]) {
    if (typeof value === 'string' && value) sources.add(value)
  }

  const results = await Promise.all([...sources].map((source) => probeMedia(source, platform)))
  if (results.includes('available')) {
    return NextResponse.json({ deleted: false, reason: 'media_still_available' }, { status: 409 })
  }
  if (results.includes('unknown')) {
    return NextResponse.json({ deleted: false, reason: 'availability_unconfirmed' }, { status: 503 })
  }

  const deleted = await sql.query(
    `delete from transcriber.ofmpro_media
      where platform = $1 and media_id = $2
      returning media_id`,
    [platform, mediaId],
  )
  return NextResponse.json({ deleted: deleted.length > 0 })
}
