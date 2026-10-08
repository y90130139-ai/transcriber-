// Enqueue the German playbook's reference videos (Geno, 2026-10-08).
//
// Input: a videos.json built from the breakdown doc's Drive links —
// one row per video: { no, id, name, part, parts }, where `no` is the
// format number in lib/german.ts and `id` is the Drive file id. Folders
// in the doc were expanded to their video files beforehand.
//
// Each video becomes a normal library job (the Mac's yt-dlp fetches
// Drive files anonymously — verified before this ran), labeled by its
// format — "German #42 · 3 Comparisons" — and tagged format=german with
// origin 'human', because the tag comes from the team's own doc, so the
// retagger must never strip it.
//
// Run:  node --import ./test/ts-resolve.mjs scripts/german-refs.mjs <videos.json> [--apply]
// Without --apply it only prints what it would do.

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { nanoid } from 'nanoid'
import { loadEnv } from './env.mjs'
import { findGerman } from '../src/lib/german'

loadEnv()
const sql = neon(process.env.DATABASE_URL)

const path = process.argv[2]
const apply = process.argv.includes('--apply')
if (!path) {
  console.error('usage: node --import ./test/ts-resolve.mjs scripts/german-refs.mjs <videos.json> [--apply]')
  process.exit(1)
}

const videos = JSON.parse(readFileSync(path, 'utf-8'))
const batchId = `german-${new Date().toISOString().slice(0, 10)}`

const rows = []
for (const video of videos) {
  const format = findGerman(String(video.no))
  if (!format) {
    console.error(`no format #${video.no} in lib/german.ts — skipped ${video.id}`)
    continue
  }
  const part = video.parts > 1 ? ` · ${video.part}/${video.parts}` : ''
  rows.push({
    url: `https://drive.google.com/file/d/${video.id}/view`,
    label: `German #${format.no} · ${format.name}${part}`,
  })
}

console.log(`${rows.length} videos across ${new Set(videos.map((v) => v.no)).size} formats · batch ${batchId}`)
for (const row of rows.slice(0, 5)) console.log(' ', row.label, '→', row.url)
if (!apply) {
  console.log('\nDry run. Re-run with --apply to enqueue.')
  process.exit(0)
}

let added = 0
let tagged = 0
for (const row of rows) {
  const [job] = await sql.query(
    `insert into transcriber.jobs (id, kind, source, source_key, label, batch_id, transcribe)
     values ($1, 'link', $2, $2, $3, $4, true)
     on conflict (source_key) do nothing
     returning id`,
    [nanoid(12), row.url, row.label, batchId],
  )
  // New or already held, the tag applies either way.
  const [held] = job
    ? [job]
    : await sql.query(`select id from transcriber.jobs where source_key = $1`, [row.url])
  if (job) added += 1
  if (held) {
    const result = await sql.query(
      `insert into transcriber.tags (job_id, axis, tag, origin, score)
       values ($1, 'format', 'german', 'human', 1)
       on conflict do nothing
       returning job_id`,
      [String(held.id)],
    )
    if (result.length > 0) tagged += 1
  }
}

console.log(`\n${added} jobs queued (${rows.length - added} already held) · ${tagged} tagged format=german`)
console.log('The Mac worker fetches them from here; watch the Queue tab fill.')
