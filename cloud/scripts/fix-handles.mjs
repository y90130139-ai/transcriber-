/** Re-file library rows under the creator's real @handle.
 *
 * Instagram puts the display name in `uploader` and the handle in `channel`,
 * and the Mac's handle picker used to try `uploader` first. Any one-word
 * display name — "Amelia", "DANIELLE🖤" — won, so 45 of 196 creators were filed
 * under a name Instagram cannot look up. The picker is fixed in
 * `src/media.py`; this repairs what it already wrote.
 *
 * The truth is on this Mac: every library row has a folder under `out/` with
 * the `source.info.json` yt-dlp wrote at fetch time, and its `channel` is the
 * handle. Nothing is re-fetched.
 *
 * Creators rows are merged, not just renamed: the display-name row's persona
 * and note move onto the handle row (unioned, never overwritten), because a
 * persona set by hand is the most expensive thing in that table.
 *
 * Dry run by default. `--apply` writes, and first saves every old value to
 * `docs/rollback/fix-handles.<timestamp>.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)
const apply = process.argv.includes('--apply')

const OUT = new URL('../../out/', import.meta.url)
const HANDLE = /^[a-z0-9._]{1,30}$/

const rows = await sql.query(
  `select job_id, author, folder, platform from transcriber.transcripts
    where folder is not null and author is not null`,
)

const moves = []               // { job_id, from, to }
for (const row of rows) {
  if (HANDLE.test(row.author)) continue
  const info = new URL(`${row.folder}/source.info.json`, OUT)
  if (!existsSync(info)) continue
  let meta
  try {
    meta = JSON.parse(readFileSync(info, 'utf8'))
  } catch {
    continue
  }
  if (!String(meta.extractor_key ?? '').toLowerCase().startsWith('instagram')) continue
  const handle = String(meta.channel ?? '').trim()
  if (!HANDLE.test(handle) || handle === row.author) continue
  moves.push({ job_id: row.job_id, from: row.author, to: handle })
}

const renames = new Map()      // old creator handle -> set of real handles
for (const move of moves) {
  if (!renames.has(move.from)) renames.set(move.from, new Set())
  renames.get(move.from).add(move.to)
}

console.log(`${moves.length} library rows to re-file, from ${renames.size} display names:`)
for (const [from, to] of renames) console.log(`  ${from} → ${[...to].join(', ')}`)

const creators = await sql.query(
  `select handle, display_name, persona, note from transcriber.creators
    where handle = any($1::text[])`,
  [[...renames.keys()]],
)

if (!apply) {
  console.log('\ndry run — pass --apply to write')
  process.exit(0)
}

const dir = new URL('../../docs/rollback/', import.meta.url)
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const record = new URL(`fix-handles.${stamp}.json`, dir)
writeFileSync(record, JSON.stringify({ moves, creators }, null, 2))
console.log(`\nrollback record: ${record.pathname}`)

for (const move of moves) {
  await sql.query(
    `update transcriber.transcripts set author = $2 where job_id = $1 and author = $3`,
    [move.job_id, move.to, move.from],
  )
}

// A display name that maps to exactly one handle carries its persona and note
// across. One that maps to several (two different people who both call
// themselves "Sophia") is ambiguous, so the handle rows start clean and the
// old row is kept for a human to read before it is deleted.
for (const creator of creators) {
  const targets = [...(renames.get(creator.handle) ?? [])]
  for (const handle of targets) {
    const carry = targets.length === 1
    await sql.query(
      `insert into transcriber.creators (handle, display_name, persona, note)
       values ($1, $2, $3::text[], $4)
       on conflict (handle) do update
          set display_name = coalesce(transcriber.creators.display_name, excluded.display_name),
              persona = (select coalesce(array_agg(distinct p), '{}')
                           from unnest(transcriber.creators.persona || excluded.persona) p),
              note = coalesce(transcriber.creators.note, excluded.note),
              updated_at = now()`,
      [handle, creator.display_name ?? creator.handle,
       carry ? creator.persona ?? [] : [], carry ? creator.note : null],
    )
  }
  const [{ left }] = await sql.query(
    `select count(*)::int as left from transcriber.transcripts where author = $1`,
    [creator.handle],
  )
  if (left === 0 && targets.length === 1) {
    await sql.query(`delete from transcriber.creators where handle = $1`, [creator.handle])
  } else {
    console.log(`  kept "${creator.handle}" — ${left} rows still under it, ${targets.length} handles`)
  }
}

console.log('done')
