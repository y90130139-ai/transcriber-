// What the hook axis actually looks like in the database right now.
// Run after a retag. Splits screen vs spoken on spoken word count.
import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)
const strip = (p) => (p || '').replace(/\[\d+:\d{2}(?::\d{2})?\]\s*(Speaker\s*\d+\s*:\s*)?/g, '').trim()
const SILENT_WORDS = 4
const PLACEHOLDERS = new Set(['text-claim', 'none', '(none)'])

const rows = await sql.query(`
  select t.job_id, t.plain, t.on_screen_text,
         (select array_agg(g.tag) from transcriber.tags g
           where g.job_id = t.job_id and g.axis = 'hook') as hooks
    from transcriber.transcripts t`)

const tally = { screen: {}, spoken: {} }
const real = { screen: 0, spoken: 0 }
const total = { screen: 0, spoken: 0 }
const withScreenText = { real: 0, total: 0 }

for (const r of rows) {
  const side = strip(r.plain).split(/\s+/).filter(Boolean).length >= SILENT_WORDS ? 'spoken' : 'screen'
  const hooks = r.hooks ?? []
  const key = hooks.length ? [...hooks].sort().join(',') : '(none)'
  tally[side][key] = (tally[side][key] ?? 0) + 1
  total[side]++
  const isReal = hooks.some((h) => !PLACEHOLDERS.has(h))
  if (isReal) real[side]++
  if (side === 'screen' && (r.on_screen_text || '').trim()) {
    withScreenText.total++
    if (isReal) withScreenText.real++
  }
}

const table = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join('\n')
for (const side of ['screen', 'spoken']) {
  console.log(`\n===== ${side.toUpperCase()} (${total[side]} rows) =====`)
  console.log(table(tally[side]))
  console.log(`real hook (not text-claim/none/untagged): ${real[side]} of ${total[side]}`)
}
console.log(`\nscreen rows that actually carry on-screen text: ${withScreenText.real} of ${withScreenText.total} have a real hook`)
