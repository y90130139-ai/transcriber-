// One-off (2026-10-20): remove the reels Instagram injected into profile
// responses and the sweep stored under a model's handle — Meta adverts and
// suggested reels that were never hers. The reader now refuses them
// (worker/ig.py belongs_to, commit 5ee1c70); this clears what landed before.
//
//   node scripts/_purge-ad-reels.mjs           # dry run, writes nothing
//   node scripts/_purge-ad-reels.mjs --write
//
// Safe to re-run. Deleting is recoverable: creator_posts upserts on post_id,
// so anything genuinely hers returns on the next sweep, while an advert
// cannot. A backup of all 8 rows is in the session scratchpad.
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'
loadEnv()
const sql = neon(process.env.DATABASE_URL)

// Five carry Meta's own ad copy; three are wild outliers against the model's
// own median (3225x, 664x, 175x) with no caption to convict them.
const ADS = ['Dd4dfPnRkgb', 'DeetdN_BmrA', 'DeSNfshPIv4', 'Dd6uCzOu4es', 'DeeuwbYhV8v']
const OUTLIERS = ['DWuzvrVxSgO', 'DdwekqbsVJC', 'DaTuOXhBd1V']
const ids = [...ADS, ...OUTLIERS]

const rows = await sql.query(
  `select post_id, handle, plays, left(coalesce(caption,''),50) caption
     from transcriber.creator_posts where post_id = any($1::text[]) order by plays desc`,
  [ids],
)
for (const r of rows) {
  console.log(`@${r.handle.padEnd(24)} ${String(r.plays).padStart(9)}  ${JSON.stringify(r.caption)}`)
}
console.log(`\n${rows.length} of ${ids.length} still present.`)

if (!process.argv.includes('--write')) {
  console.log('DRY RUN - nothing deleted. Re-run with --write to apply.')
  process.exit(0)
}
const gone = await sql.query(
  `delete from transcriber.creator_posts where post_id = any($1::text[]) returning post_id`,
  [ids],
)
console.log(`\ndeleted ${gone.length} rows.`)
