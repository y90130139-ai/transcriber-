import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)
const rows = await sql.query(`
  select t.job_id, t.plain, t.on_screen_text, t.on_screen_captions,
         t.duration_sec,
         (select array_agg(tag) from transcriber.tags g where g.job_id=t.job_id and g.axis='hook') as hooks
    from transcriber.transcripts t
   order by t.transcribed_at desc`)
const strip = (p) => (p||'').replace(/\[\d+:\d{2}(?::\d{2})?\]\s*(Speaker\s*\d+\s*:\s*)?/g,'').trim()
let silent=0
for (const r of rows) {
  const w = strip(r.plain).split(/\s+/).filter(Boolean).length
  if (w >= 4) continue
  silent++
  console.log('---', r.job_id, '| hooks:', (r.hooks||[]).join(',')||'(none)', '| words:', w, '| dur:', r.duration_sec)
  const beats = (r.on_screen_captions||[]).map(c=>c?.text).filter(Boolean)
  console.log('   screen:', JSON.stringify(r.on_screen_text||'').slice(0,300))
  console.log('   beats :', JSON.stringify(beats).slice(0,400))
}
console.error('silent rows:', silent, 'of', rows.length)
