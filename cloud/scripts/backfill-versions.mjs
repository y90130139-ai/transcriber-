// Lift the "Versions — what changes each time" bullets out of `notes` and
// into `plan_items.versions` (Geno, 2026-10-13), so the versions are fields
// again — chips on the row, editable in the card, rendered on her page.
//
// The bullets were written by the composer and by the one-off merge, in one
// shape:
//
//   Versions — what changes each time
//   • Version 1 — bright bikini top · “caption”
//
// Dry run by default; --apply writes. Idempotent: a card whose notes carry no
// marker is left alone, and one that already has versions is skipped.
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, '')]
    }),
)
const sql = neon(env.DATABASE_URL)
const apply = process.argv.includes('--apply')

const MARKER = 'Versions — what changes each time'

/** "• Version 2 — low-cut top · “caption”" → { outfit, caption }. */
function parseBullet(line) {
  const body = line.replace(/^•\s*Version\s*\d+\s*—\s*/, '').trim()
  if (!body) return null
  const at = body.indexOf(' · “')
  if (at >= 0) {
    const caption = body.slice(at + 3).trim()
    return { outfit: body.slice(0, at).trim(), caption: caption.replace(/”$/, '') }
  }
  if (body.startsWith('“') && body.endsWith('”')) return { outfit: '', caption: body.slice(1, -1) }
  return { outfit: body, caption: '' }
}

const rows = await sql.query(
  `select id, plan_id, card_no, title, notes, versions
     from transcriber.plan_items
    where notes like '%' || $1 || '%'`,
  [MARKER],
)

let lifted = 0
for (const row of rows) {
  if (Array.isArray(row.versions) && row.versions.length > 0) continue
  const notes = String(row.notes ?? '')
  const at = notes.indexOf(MARKER)
  if (at < 0) continue
  const block = notes.slice(at + MARKER.length)
  const bullets = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('•'))
    .map(parseBullet)
    .filter((version) => version && (version.outfit || version.caption))
  if (bullets.length < 2) continue
  const cleaned = notes.slice(0, at).trim()
  console.log(`lift   V-${row.card_no} "${row.title}": ${bullets.length} versions`)
  if (apply) {
    await sql.query(
      `update transcriber.plan_items set versions = $2::jsonb, notes = $3 where id = $1`,
      [row.id, JSON.stringify(bullets), cleaned || null],
    )
  }
  lifted += 1
}

console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'}: ${lifted} card(s) lifted`)
