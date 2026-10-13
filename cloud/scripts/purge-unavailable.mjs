// Probe OFMPro previews and delete the ones the player cannot open.
// A row stays if any source still answers as media. A timeout or an
// ambiguous status stays too — only a confirmed dead file is removed.
//
//   node --experimental-strip-types --import ./test/ts-resolve.mjs scripts/purge-unavailable.mjs twitter
//   node --experimental-strip-types --import ./test/ts-resolve.mjs scripts/purge-unavailable.mjs twitter --dry-run
import { loadEnv } from './env.mjs'

loadEnv()

const { neon } = await import('@neondatabase/serverless')
const { ofmproR2Config, presignGet } = await import('../src/lib/r2.ts')

const platform = (process.argv[2] || '').trim().toLowerCase()
const dryRun = process.argv.includes('--dry-run')
const allowed = new Set(['instagram', 'tiktok', 'twitter'])
if (!allowed.has(platform)) {
  console.error('usage: purge-unavailable.mjs <instagram|tiktok|twitter> [--dry-run]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)
const r2 = ofmproR2Config()
if (!r2) {
  console.warn('warning: OFMPRO_R2_* is not set — R2 mirrors will NOT be probed.')
  console.warn('         Rows whose only live source is their R2 copy would count as dead.')
}
const CONCURRENCY = 16

function hostOf(url) {
  try { return new URL(url).host } catch { return 'bad-url' }
}

async function probe(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return 'unavailable'
    const headers = new Headers({
      Range: 'bytes=0-1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: '*/*',
    })
    if (platform !== 'twitter') headers.set('Referer', 'https://app.ofmpro.com/')
    const response = await fetch(parsed, {
      headers,
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
    })
    try { await response.body?.cancel() } catch { /* status is enough */ }
    const type = (response.headers.get('content-type') || '').toLowerCase()
    if (response.status >= 200 && response.status < 300) {
      if (type.startsWith('text/html') || type.startsWith('application/json') || type.startsWith('text/plain')) {
        return 'unavailable'
      }
      return 'available'
    }
    if ([401, 403, 404, 410].includes(response.status)) return 'unavailable'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function sourcesFor(row) {
  const urls = []
  if (typeof row.r2_key === 'string' && row.r2_key && r2) urls.push(presignGet(r2, row.r2_key))
  if (typeof row.raw_url === 'string' && row.raw_url) urls.push(row.raw_url)
  if (typeof row.mirror_url === 'string' && row.mirror_url && row.mirror_url !== row.raw_url) urls.push(row.mirror_url)
  return urls
}

const rows = await sql.query(
  `select media_id, raw_url, mirror_url, r2_key
     from transcriber.ofmpro_media
    where platform = $1
      and unavailable_at is null`,
  [platform],
)
console.log(`${platform}: ${rows.length} rows still in the feed`)

const tally = { deleted: 0, kept: 0, unknown: 0, empty: 0 }
const hosts = new Map()
const deadIds = []

let cursor = 0
async function worker() {
  for (;;) {
    const index = cursor
    cursor += 1
    if (index >= rows.length) return
    const row = rows[index]
    const urls = sourcesFor(row)
    if (urls.length === 0) {
      tally.empty += 1
      deadIds.push(row.media_id)
      continue
    }
    const results = await Promise.all(urls.map(async (url) => {
      const result = await probe(url)
      const key = `${hostOf(url)} ${result}`
      hosts.set(key, (hosts.get(key) || 0) + 1)
      return result
    }))
    if (results.includes('available')) tally.kept += 1
    else if (results.includes('unknown')) tally.unknown += 1
    else {
      tally.deleted += 1
      deadIds.push(row.media_id)
    }
    const done = tally.deleted + tally.kept + tally.unknown + tally.empty
    if (done % 100 === 0) console.log(`  checked ${done}/${rows.length}  dead ${tally.deleted + tally.empty}`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

console.log('hosts:')
for (const [key, count] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${key}`)
}
console.log(`kept ${tally.kept}  unknown ${tally.unknown}  dead ${tally.deleted}  no-source ${tally.empty}`)

if (dryRun) {
  console.log('dry run — nothing deleted')
  process.exit(0)
}

const CHUNK = 200
let removed = 0
for (let i = 0; i < deadIds.length; i += CHUNK) {
  const chunk = deadIds.slice(i, i + CHUNK)
  const deleted = await sql.query(
    `delete from transcriber.ofmpro_media
      where platform = $1
        and media_id = any($2::text[])
      returning media_id`,
    [platform, chunk],
  )
  removed += deleted.length
  console.log(`  deleted ${removed}/${deadIds.length}`)
}
console.log(`removed ${removed} ${platform} rows`)
