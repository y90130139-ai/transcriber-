// Fill the library columns from what is already on disk in ../out.
//
// Every finished job left a folder behind holding the platform's own metadata,
// so engagement, the creator handle and the local video path can all be
// recovered without touching Instagram again. Safe to re-run; it only writes
// columns that are still empty unless --force is passed.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)
const force = process.argv.includes('--force')
const OUT = new URL('../../out/', import.meta.url).pathname

/** The pipeline names every folder `<slug>--<sha256(source)[:8]>`. */
const jobKey = (source) => createHash('sha256').update(source).digest('hex').slice(0, 8)

const folders = readdirSync(OUT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const byKey = new Map()
for (const folder of folders) {
  const key = folder.slice(-8)
  if (/^[0-9a-f]{8}$/.test(key)) byKey.set(key, folder)
}

// index.jsonl is the pipeline's own source -> folder ledger; it covers uploads
// whose slug carries no hash we can recompute from a URL.
const bySource = new Map()
const ledger = join(OUT, 'index.jsonl')
if (existsSync(ledger)) {
  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (row.source && row.folder) bySource.set(row.source, row.folder)
    } catch { /* a half-written line is not worth failing the backfill over */ }
  }
}

function info(folder) {
  const path = join(OUT, folder, 'source.info.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const isoDate = (raw) =>
  typeof raw === 'string' && /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`
    : null

/** Instagram puts the @handle in `channel`; TikTok puts it in `uploader`. */
function handleOf(meta) {
  const candidates = [meta.channel, meta.uploader, meta.uploader_id]
  return (
    candidates.find((value) => value && !value.includes(' ') && !/^\d+$/.test(value)) ??
    candidates.find(Boolean) ??
    null
  )
}

const jobs = await sql.query(
  `select j.id, j.source, t.job_id as has_transcript, t.folder, t.like_count, t.author
     from transcriber.jobs j
     left join transcriber.transcripts t on t.job_id = j.id`,
)

let matched = 0
let updated = 0
let missing = 0
const creators = new Map()

for (const job of jobs) {
  const folder = byKey.get(jobKey(job.source)) ?? bySource.get(job.source) ?? null
  if (!folder) {
    missing += 1
    continue
  }
  matched += 1
  if (!job.has_transcript) continue // a failed job has no row to fill
  if (!force && job.folder && job.like_count !== null) continue

  const meta = info(folder)
  const handle = meta ? handleOf(meta) : null

  await sql.query(
    `update transcriber.transcripts
        set folder        = $2,
            like_count    = coalesce($3, like_count),
            comment_count = coalesce($4, comment_count),
            post_id       = coalesce($5, post_id),
            author        = coalesce($6, author),
            author_name   = coalesce($7, author_name),
            upload_date   = coalesce($8, upload_date)
      where job_id = $1`,
    [
      job.id,
      folder,
      meta?.like_count ?? null,
      meta?.comment_count ?? null,
      meta?.id ?? null,
      handle,
      meta?.uploader ?? null,
      isoDate(meta?.upload_date),
    ],
  )
  updated += 1

  if (handle) creators.set(handle, meta?.uploader ?? null)
}

for (const [handle, displayName] of creators) {
  await sql.query(
    `insert into transcriber.creators (handle, display_name)
     values ($1, $2)
     on conflict (handle) do update
        set display_name = coalesce(excluded.display_name, transcriber.creators.display_name),
            updated_at = now()`,
    [handle, displayName],
  )
}

console.log(`folders on disk : ${folders.length}`)
console.log(`jobs in database: ${jobs.length}`)
console.log(`matched to disk : ${matched}${missing ? ` (${missing} with no folder)` : ''}`)
console.log(`rows updated    : ${updated}`)
console.log(`creators         : ${creators.size}`)
