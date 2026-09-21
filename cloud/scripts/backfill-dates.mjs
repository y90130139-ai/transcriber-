/** Date the posts the sweep stored without one, from their own shortcode.
 *
 * lib/postid.ts explains the measurement: a shortcode is the post id in
 * base64, and the id carries its creation time (344 of 500 within a minute of
 * the real taken_at, misses running earlier rather than later). This fills the
 * rows that arrived from the reels tab with play counts and no date.
 *
 * Also stamps every row that already has a date as `taken_at`, so the column
 * is never ambiguous: a null source means "we do not know where this came
 * from", not "this one is fine".
 *
 * Reversible without a record file, because nothing is overwritten: every
 * date this writes is labelled `id`, and
 *   update ... set posted_at = null, posted_at_source = null where posted_at_source = 'id'
 * puts it all back. Dry run by default; --apply writes.
 */
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)
const apply = process.argv.includes('--apply')

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const EPOCH_MS = 1_314_220_021_721n
const EARLIEST = Date.UTC(2012, 0, 1)

function dateOf(code) {
  let n = 0n
  for (const ch of String(code).slice(0, 11)) {
    const digit = ALPHABET.indexOf(ch)
    if (digit < 0) return null
    n = n * 64n + BigInt(digit)
  }
  const ms = Number((n >> 23n) + EPOCH_MS)
  if (!Number.isFinite(ms) || ms < EARLIEST || ms > Date.now() + 86_400_000) return null
  return new Date(ms).toISOString()
}

for (const table of ['creator_posts', 'sightings']) {
  const undated = await sql.query(
    `select post_id from transcriber.${table} where posted_at is null`,
  )
  const filled = []
  for (const row of undated) {
    const at = dateOf(row.post_id)
    if (at) filled.push({ post_id: row.post_id, at })
  }
  const [labelled] = await sql.query(
    `select count(*)::int as n from transcriber.${table}
      where posted_at is not null and posted_at_source is null`,
  )
  console.log(`${table}: ${undated.length} undated, ${filled.length} datable from the id, ` +
    `${labelled.n} dated rows to label as taken_at`)

  if (!apply) continue

  await sql.query(
    `update transcriber.${table} set posted_at_source = 'taken_at'
      where posted_at is not null and posted_at_source is null`,
  )
  for (let i = 0; i < filled.length; i += 500) {
    const chunk = filled.slice(i, i + 500)
    await sql.query(
      `update transcriber.${table} t
          set posted_at = x.at::timestamptz, posted_at_source = 'id'
         from jsonb_to_recordset($1::jsonb) as x(post_id text, at text)
        where t.post_id = x.post_id and t.posted_at is null`,
      [JSON.stringify(chunk)],
    )
  }
  console.log(`  applied`)
}
if (!apply) console.log('\ndry run — pass --apply to write')
