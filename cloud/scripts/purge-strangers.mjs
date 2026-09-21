/** Remove the analytics rows swept from accounts that were never ours.
 *
 * Six creators were filed under one-word display names that are real
 * Instagram accounts belonging to other people ("honey" is a 102k-follower
 * stranger). `fix-handles.mjs` moves our own library rows to the real
 * handles; this removes what the sweep read from the strangers, which is
 * every `sightings`, `creator_posts` and `creator_snapshots` row under the
 * wrong name, plus the watchlist row itself once nothing of ours is left
 * under it.
 *
 * Nothing of ours is touched: a name is only listed here because
 * `fix-handles` proved, from the `source.info.json` yt-dlp wrote at fetch
 * time, that our rows under it belong to a different handle.
 *
 * Dry run by default. `--apply` writes, and first saves every row it will
 * delete to `docs/rollback/purge-strangers.<timestamp>.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)
const apply = process.argv.includes('--apply')

/** Proven by fix-handles.mjs on 2026-09-20; see that run's rollback record. */
const WRONG = ['honey', 'scarlet', 'vampy', 'mya', 'r4ven', 'mila']
const TABLES = ['sightings', 'creator_posts', 'creator_snapshots']

const record = { wrong: WRONG }
for (const table of TABLES) {
  record[table] = await sql.query(
    `select * from transcriber.${table} where handle = any($1::text[])`, [WRONG],
  )
}
record.creators = await sql.query(
  `select * from transcriber.creators where handle = any($1::text[])`, [WRONG],
)

// A name that still has library rows under it was not fully re-filed, so its
// creators row stays for a human to look at rather than disappearing.
const stillOurs = await sql.query(
  `select distinct author from transcriber.transcripts where author = any($1::text[])`, [WRONG],
)
const orphaned = WRONG.filter((h) => !stillOurs.some((row) => row.author === h))

for (const table of TABLES) console.log(`${table}: ${record[table].length} rows`)
console.log(`creators rows to remove: ${orphaned.join(', ') || 'none'}`)
if (stillOurs.length) {
  console.log(`kept (library rows still under them): ${stillOurs.map((r) => r.author).join(', ')}`)
}

if (!apply) {
  console.log('\ndry run — pass --apply to write')
  process.exit(0)
}

const dir = new URL('../../docs/rollback/', import.meta.url)
mkdirSync(dir, { recursive: true })
const path = new URL(`purge-strangers.${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir)
writeFileSync(path, JSON.stringify(record, null, 2))
console.log(`\nrollback record: ${path.pathname}`)

for (const table of TABLES) {
  const gone = await sql.query(
    `delete from transcriber.${table} where handle = any($1::text[]) returning handle`, [WRONG],
  )
  console.log(`  ${table}: ${gone.length} removed`)
}
if (orphaned.length) {
  const gone = await sql.query(
    `delete from transcriber.creators where handle = any($1::text[]) returning handle`, [orphaned],
  )
  console.log(`  creators: ${gone.length} removed`)
}
console.log('done')
