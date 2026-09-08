/** Bring existing jobs onto the current dedupe key.
 *
 * `source_key` is unique and is how a re-paste is recognised as already in the
 * library. When normalizeUrl learns a new equivalence — www vs bare, http vs
 * https, /p/ vs /reel/ — every row written under the old rules stops matching
 * what a fresh paste produces, and the next paste of a post already here adds
 * it a second time. Run this once after any change to normalizeUrl.
 *
 * `source` is deliberately left alone: it is what the Mac hands to yt-dlp, and
 * a link that has already fetched successfully is not worth re-writing.
 */
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'
import { normalizeUrl } from '../src/lib/links.ts'

loadEnv()
const sql = neon(process.env.DATABASE_URL)

const apply = process.argv.includes('--apply')

const jobs = await sql.query(
  `select id, kind, source, source_key, status from transcriber.jobs where kind = 'link'`,
)

const taken = new Map()               // desired key -> rows that want it
for (const job of jobs) {
  const next = normalizeUrl(job.source_key ?? job.source)
  if (next === job.source_key) continue
  if (!taken.has(next)) taken.set(next, [])
  taken.get(next).push(job)
}

let changed = 0
const collisions = []
for (const [key, rows] of taken) {
  // Another row may already sit on the key these want, or two of them may now
  // want the same one. Either way only the oldest keeps it; the rest are
  // genuine duplicates that the old rules let through.
  const [existing] = await sql.query(
    `select id from transcriber.jobs where source_key = $1`, [key],
  )
  const winner = existing ? null : rows[0]
  const losers = existing ? rows : rows.slice(1)
  if (winner) {
    if (apply) {
      await sql.query(`update transcriber.jobs set source_key = $2 where id = $1`,
        [winner.id, key])
    }
    changed++
  }
  for (const row of losers) collisions.push({ id: row.id, key, source: row.source })
}

console.log(`${jobs.length} link jobs`)
console.log(`${changed} ${apply ? 'rekeyed' : 'would be rekeyed'}`)
if (collisions.length) {
  console.log(`\n${collisions.length} now collide with a row already on that key —`)
  console.log('these are duplicates the old rules let through. Left in place; delete by hand if you want them gone.')
  for (const row of collisions) console.log(`  ${row.id}  ${row.source}`)
}
if (!apply) console.log('\ndry run — pass --apply to write')
process.exit(0)
