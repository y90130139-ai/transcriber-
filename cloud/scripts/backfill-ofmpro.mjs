/**
 * One-time backfill: the three OFMPro medias exports → transcriber.ofmpro_media.
 *
 * The exports at the repo root are the raw `/v2/medias/fetch` payloads Geno
 * pulled by hand. This is the same trim `import-ofmpro.mjs` makes for the
 * public assets, written into the table the worker will own from now on.
 *
 *   node scripts/backfill-ofmpro.mjs
 */
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)

const ROOT = 'E:/dashboard-fanslink'
const SOURCES = [
  { platform: 'instagram', file: `${ROOT}/ofmpro-instagram-medias-2026-10-06-to-2026-10-07.json` },
  { platform: 'tiktok', file: `${ROOT}/ofmpro-tiktok-medias-2026-10-06-to-2026-10-07.json` },
  { platform: 'twitter', file: `${ROOT}/ofmpro-twitter-medias-2026-10-06-to-2026-10-07.json` },
]

const BATCH = 200

/** One raw item → one row, deduped by media id (a later copy fills holes). */
function rowsFor(platform, raw) {
  const byId = new Map()
  for (const item of raw.items ?? []) {
    const id = String(item.id ?? item.external_id ?? '')
    if (!id) continue
    const pictures = item.type === 'IMAGE' || item.type === 'SLIDESHOW'
    const row = {
      platform,
      media_id: id,
      shortcode: item.shortcode ?? null,
      post_url: item.share_url ?? null,
      posted_at: item.created_at ?? null,
      caption: item.caption ?? null,
      media_type: item.type ?? null,
      slides: item.type === 'SLIDESHOW' ? item.raw_source_urls?.length ?? null : null,
      views: item.view_count ?? 0,
      likes: item.like_count ?? 0,
      comments: item.comment_count ?? 0,
      score: typeof item.outer_score === 'number' ? Math.round(item.outer_score * 100) / 100 : null,
      username: item.account_data?.username ?? null,
      nickname: item.account_data?.nickname ?? null,
      followers: item.account_data?.follower_count ?? null,
      audio: item.audio_data?.name ?? null,
      raw: pictures ? null : item.raw_source_urls?.[0] ?? null,
      image: pictures ? item.raw_source_urls?.[0] ?? null : null,
      mirror: item.source_urls?.[0] ?? null,
    }
    const held = byId.get(id)
    if (!held) { byId.set(id, row); continue }
    for (const field of ['shortcode', 'post_url', 'posted_at', 'caption', 'media_type', 'username', 'nickname', 'followers', 'audio', 'raw', 'image', 'mirror']) {
      if (held[field] == null && row[field] != null) held[field] = row[field]
    }
    if (held.score == null) held.score = row.score
    if (held.slides == null) held.slides = row.slides
    if (row.views > held.views) { held.views = row.views; held.likes = row.likes; held.comments = row.comments }
  }
  return [...byId.values()]
}

const COLUMNS = [
  'platform', 'media_id', 'shortcode', 'post_url', 'posted_at', 'caption', 'media_type', 'slides',
  'view_count', 'like_count', 'comment_count', 'score', 'username', 'nickname', 'followers', 'audio',
  'raw_url', 'mirror_url',
]

async function upsert(rows) {
  for (let at = 0; at < rows.length; at += BATCH) {
    const chunk = rows.slice(at, at + BATCH)
    const values = chunk.map((row, index) => {
      const base = index * COLUMNS.length
      return `(${COLUMNS.map((_, column) => `$${base + column + 1}`).join(',')})`
    })
    const params = chunk.flatMap((row) => [
      row.platform, row.media_id, row.shortcode, row.post_url, row.posted_at, row.caption,
      row.media_type, row.slides, row.views, row.likes, row.comments, row.score,
      row.username, row.nickname, row.followers, row.audio,
      row.raw ?? row.image, row.mirror,
    ])
    await sql.query(
      `insert into transcriber.ofmpro_media
         (platform, media_id, shortcode, post_url, posted_at, caption, media_type, slides,
          view_count, like_count, comment_count, score, username, nickname, followers, audio,
          raw_url, mirror_url)
       values ${values.join(',')}
       on conflict (platform, media_id) do update set
         shortcode = excluded.shortcode, post_url = excluded.post_url,
         posted_at = excluded.posted_at, caption = excluded.caption,
         media_type = excluded.media_type, slides = excluded.slides,
         view_count = excluded.view_count, like_count = excluded.like_count,
         comment_count = excluded.comment_count, score = excluded.score,
         username = excluded.username, nickname = excluded.nickname,
         followers = excluded.followers, audio = excluded.audio,
         raw_url = coalesce(excluded.raw_url, transcriber.ofmpro_media.raw_url),
         mirror_url = coalesce(excluded.mirror_url, transcriber.ofmpro_media.mirror_url),
         updated_at = now()`,
      params,
    )
  }
}

for (const source of SOURCES) {
  const raw = JSON.parse(readFileSync(source.file, 'utf8'))
  const rows = rowsFor(source.platform, raw)
  await upsert(rows)
  const [count] = await sql.query(
    `select count(*)::int as n from transcriber.ofmpro_media where platform = $1`,
    [source.platform],
  )
  console.log(`${source.platform}: ${rows.length} rows from export · ${count.n} now held`)
}
console.log('backfill done')
