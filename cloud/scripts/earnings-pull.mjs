// The earnings run from the Mac, with no time limit — for the first 120-day
// backfill, which is too long for one Vercel call. Same code as the cron.
//   node --import ./test/ts-resolve.mjs scripts/earnings-pull.mjs [--no-draft]
// Needs DATABASE_URL, INFLOWW_API_KEY and INFLOWW_OID in .env.local.
import { loadEnv } from './env.mjs'

loadEnv()
const { runEarnings } = await import('../src/lib/earnings/job.ts')
const result = await runEarnings({ deadline: Date.now() + 6 * 3_600_000, draft: !process.argv.includes('--no-draft') })
for (const p of result.pulled) console.log(`pulled  ${p.name.padEnd(24)} through ${p.through}`)
for (const e of result.errors) console.log(`ERROR   ${e.name.padEnd(24)} ${e.error}`)
console.log(`\ncomplete: ${result.complete}  drafted: ${result.drafted.join(', ') || 'none'}  alerts: ${result.alerts}`)
