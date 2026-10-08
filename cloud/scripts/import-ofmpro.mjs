/**
 * Import an OFMPro medias export into the console's platform feed asset.
 *
 * Geno's exports are the raw `/v2/medias/fetch` payload: `items` carries every
 * row the pages returned, which includes re-tracked duplicates of the same
 * media id. The console only needs one clean row per post, so this script
 * dedupes by id (merging any facts the later copy filled in), keeps the
 * fields the feeds actually draw, and writes the asset the platform page
 * fetches from `public/`.
 *
 *   node scripts/import-ofmpro.mjs instagram [input.json] [output.json]
 *   node scripts/import-ofmpro.mjs tiktok
 *   node scripts/import-ofmpro.mjs twitter
 *
 * Twitter rows are not all video: IMAGE and SLIDESHOW rows carry pictures
 * (the slideshow keeps its first frame plus the slide count), so the feed
 * can draw them beside the videos.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const PLATFORMS = {
  instagram: {
    source: 'E:/dashboard-fanslink/ofmpro-instagram-medias-2026-10-06-to-2026-10-07.json',
    asset: '../public/instagram/medias.json',
  },
  tiktok: {
    source: 'E:/dashboard-fanslink/ofmpro-tiktok-medias-2026-10-06-to-2026-10-07.json',
    asset: '../public/tiktok/medias.json',
  },
  twitter: {
    source: 'E:/dashboard-fanslink/ofmpro-twitter-medias-2026-10-06-to-2026-10-07.json',
    asset: '../public/twitter/medias.json',
  },
}

const platform = (process.argv[2] ?? 'instagram').toLowerCase()
const spec = PLATFORMS[platform]
if (!spec) throw new Error(`unknown platform "${platform}" — expected one of ${Object.keys(PLATFORMS).join(', ')}`)

const input = resolve(process.argv[3] ?? spec.source)
const output = resolve(process.argv[4] ?? resolve(here, spec.asset))

const raw = JSON.parse(readFileSync(input, 'utf8'))

/** One row per media id; a later duplicate only fills holes the first had. */
const byId = new Map()
for (const item of raw.items ?? []) {
  const id = item.id ?? item.external_id
  if (!id) continue
  const pictures = item.type === 'IMAGE' || item.type === 'SLIDESHOW'
  const clean = {
    id,
    shortcode: item.shortcode ?? null,
    url: item.share_url ?? null,
    created: item.created_at ?? null,
    caption: item.caption ?? null,
    type: item.type ?? null,
    views: item.view_count ?? 0,
    likes: item.like_count ?? 0,
    comments: item.comment_count ?? 0,
    score: typeof item.outer_score === 'number' ? Math.round(item.outer_score * 100) / 100 : null,
    username: item.account_data?.username ?? null,
    nickname: item.account_data?.nickname ?? null,
    followers: item.account_data?.follower_count ?? null,
    audio: item.audio_data?.name ?? null,
    video: pictures ? null : item.raw_source_urls?.[0] ?? null,
    image: pictures ? item.raw_source_urls?.[0] ?? null : null,
    slides: item.type === 'SLIDESHOW' ? item.raw_source_urls?.length ?? null : null,
    mirror: item.source_urls?.[0] ?? null,
  }
  const held = byId.get(id)
  if (!held) {
    byId.set(id, clean)
    continue
  }
  for (const field of ['shortcode', 'url', 'created', 'caption', 'type', 'username', 'nickname', 'followers', 'audio', 'video', 'image', 'mirror']) {
    if (held[field] == null && clean[field] != null) held[field] = clean[field]
  }
  if (held.score == null && clean.score != null) held.score = clean.score
  if (held.slides == null && clean.slides != null) held.slides = clean.slides
  // Tracking runs again on later pages; keep the highest reading.
  if (clean.views > held.views) {
    held.views = clean.views
    held.likes = clean.likes
    held.comments = clean.comments
  }
}

const items = [...byId.values()]
const creators = new Set(items.map((item) => item.username).filter(Boolean))
const totals = items.reduce(
  (sum, item) => {
    sum.views += item.views
    sum.likes += item.likes
    sum.comments += item.comments
    return sum
  },
  { views: 0, likes: 0, comments: 0 },
)
const withScore = items.filter((item) => item.score != null)

const payload = {
  platform,
  source: 'ofmpro · v2/medias/fetch',
  window: {
    from: raw.query?.minimum_created_at ?? null,
    to: raw.query?.maximum_created_at ?? null,
  },
  imported_at: new Date().toISOString(),
  rows: raw.retrieved_item_count ?? (raw.items ?? []).length,
  unique: items.length,
  duplicates: (raw.retrieved_item_count ?? items.length) - items.length,
  totals: { ...totals, creators: creators.size, scored: withScore.length },
  items,
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(payload))

console.log(`platform ${platform}`)
console.log(`in  ${input}`)
console.log(`out ${output}`)
console.log(`rows ${payload.rows} · unique ${payload.unique} · duplicates merged ${payload.duplicates}`)
console.log(`creators ${creators.size} · views ${totals.views.toLocaleString()} · likes ${totals.likes.toLocaleString()} · comments ${totals.comments.toLocaleString()}`)
console.log(`wrote ${(statSync(output).size / 1024 / 1024).toFixed(2)} MB`)
