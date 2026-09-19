/** Fetch each watched creator's profile: bio, category, followers.
 *
 * The sweep reads their reels; this reads the account itself. A bio is the
 * densest evidence there is for how a creator is positioned — it says "mom of
 * 3" or "goth mommy" outright, where a still frame can only suggest it — and
 * the category label is what says whether an account is professional at all.
 *
 * About $0.0023 a profile, so the whole watchlist is under fifty cents. Run it
 * when the watchlist grows, not weekly: bios change rarely.
 *
 *   node scripts/profiles.mjs            # only creators never profiled
 *   node scripts/profiles.mjs --all      # refresh everyone
 */
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { loadEnv } from './env.mjs'

loadEnv()
const sql = neon(process.env.DATABASE_URL)
const token =
  process.env.APIFY_TOKEN ??
  JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8')).scout?.apify_token
if (!token) throw new Error('no Apify token — set scout.apify_token in config.json')

const all = process.argv.includes('--all')
const rows = await sql.query(
  `select handle from transcriber.creators
    where watch = 'watching' ${all ? '' : 'and profile_at is null'}
    order by handle`,
)
const handles = rows.map((row) => String(row.handle))
if (handles.length === 0) {
  console.log('every watched creator already has a profile')
  process.exit(0)
}
console.log(`${handles.length} profiles ≈ $${(handles.length * 0.0023).toFixed(2)}`)

const started = await fetch(
  `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${token}&maxTotalChargeUsd=${(handles.length * 0.004).toFixed(2)}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: handles }),
  },
)
if (!started.ok) throw new Error(`Apify ${started.status}: ${(await started.text()).slice(0, 200)}`)
const items = await started.json()

const clean = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
const written = []
for (const item of Array.isArray(items) ? items : []) {
  const handle = String(item.username ?? '').toLowerCase()
  if (!handle) continue
  written.push(handle)
  await sql.query(
    `update transcriber.creators
        set bio = $2, category = $3, followers = $4, is_private = $5,
            display_name = coalesce(nullif($6, ''), display_name),
            profile_at = now()
      where handle = $1`,
    [
      handle,
      clean(item.biography, 1000),
      clean(item.businessCategoryName ?? item.categoryName ?? item.categoryEnum, 120),
      Number.isFinite(item.followersCount) ? item.followersCount : null,
      typeof item.private === 'boolean' ? item.private : null,
      clean(item.fullName, 200) ?? '',
    ],
  )
}
console.log(`profiles written: ${written.length} of ${handles.length}`)
const [counts] = await sql.query(
  `select count(*) filter (where bio is not null)::int with_bio,
          count(*) filter (where category is not null)::int with_category,
          count(*) filter (where is_private)::int private
     from transcriber.creators where watch = 'watching'`,
)
console.log('watchlist now:', JSON.stringify(counts))
