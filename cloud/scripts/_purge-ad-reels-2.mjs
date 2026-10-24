// One-off (2026-10-20): the second and final batch of injected reels — the
// four Geno confirmed plus Faye's Meta Connect advert, which the first purge
// missed because it was on her second account (madebyfaye17, not the
// fayebae2001 on her model row) and she is paused, so the first scan's
// status='active' filter skipped her entirely.
//
//   node scripts/_purge-ad-reels-2.mjs           # dry run
//   node scripts/_purge-ad-reels-2.mjs --write
//
// Safe to re-run. creator_posts upserts on post_id, so anything genuinely
// hers returns on the next sweep; an advert cannot, because worker/ig.py
// belongs_to (5ee1c70) now refuses any item whose owner is not her.
// A backup of all five rows is in the session scratchpad.
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'
loadEnv()
const sql = neon(process.env.DATABASE_URL)

const ids = ['DcHmC4ABxEm', 'DaWTAgpyLlp', 'DaneAOjx7Xu', 'Deh4E0pOFKI', 'DdukdCRy51K']

const rows = await sql.query(
  `select post_id, handle, plays, likes, left(coalesce(caption,''),46) caption
     from transcriber.creator_posts where post_id = any($1::text[]) order by plays desc`,
  [ids],
)
for (const r of rows) {
  const eng = ((Number(r.likes) / Number(r.plays)) * 100).toFixed(2)
  console.log(`@${r.handle.padEnd(24)} ${String(r.plays).padStart(9)} plays · ${eng}% eng  ${JSON.stringify(r.caption)}`)
}
console.log(`\n${rows.length} of ${ids.length} still present.`)

// Praise built on an advert is the one thing worse than the advert.
const cards = await sql.query(
  `select count(*)::int c from transcriber.shoutouts where post_ids && $1::text[]`,
  [ids],
)
console.log(`shout-out cards referencing any of them: ${cards[0].c}`)

if (!process.argv.includes('--write')) {
  console.log('DRY RUN - nothing deleted. Re-run with --write to apply.')
  process.exit(0)
}
const gone = await sql.query(
  `delete from transcriber.creator_posts where post_id = any($1::text[]) returning post_id`,
  [ids],
)
console.log(`\ndeleted ${gone.length} rows.`)
