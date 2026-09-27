// Weeks from this Monday on — draft or sent — that still have cards with no
// captions, oldest week first. Sent weeks too since 2026-09-27: their stock
// placeholder captions were cleared, and the engine only ever fills empty cards
// on a sent week, never rewrites. Printed as "<plan_id> <model name>" for
// bin/captions-nightly.
import { neon } from '@neondatabase/serverless'
import { loadEnv } from './env.mjs'
loadEnv()
const sql = neon(process.env.DATABASE_URL)
const rows = await sql.query(`
  select p.id, m.name
    from transcriber.plans p join transcriber.models m on m.id = p.model_id
   where p.week_of >= date_trunc('week', now())::date
     and exists (select 1 from transcriber.plan_items i
                  where i.plan_id = p.id
                    and (i.caption_options is null or i.caption_options = '[]'::jsonb))
   order by p.week_of, m.name`)
for (const r of rows) console.log(`${r.id} ${String(r.name).replace(/\s+/g, '_')}`)
