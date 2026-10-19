// What is on the Infloww key that transcriber does not know about yet.
//   node --import ./test/ts-resolve.mjs scripts/infloww-new.mjs [--watch]
//
// Infloww re-issued every creator id on 2026-10-11 and then kept adding
// accounts for days afterwards (Geno: "make sure to double check until 4-5
// more models have been added onto the api key"). Until the rotated key is on
// Vercel the nightly cron pulls nothing, so this is the hand check — and with
// --watch it polls every three minutes and prints only what changes.
//
// Read-only: it never writes. `npm run earnings -- --no-draft` is what seeds
// and backfills whatever this finds.
import { loadEnv } from './env.mjs'

loadEnv()
const { listCreators } = await import('../src/lib/earnings/infloww.ts')
const { loadAccounts } = await import('../src/lib/earnings/store.ts')

const POLL_MS = 180_000

async function report() {
  const live = await listCreators(Date.now() + 90_000)
  const accounts = await loadAccounts()
  const held = new Map(accounts.map((a) => [a.infloww_id, a]))
  const liveIds = new Set(live.map((c) => c.id))

  const unknown = live.filter((c) => !held.has(c.id))
  const unlinked = live.filter((c) => held.get(c.id) && !held.get(c.id).model_id)
  const vanished = accounts.filter((a) => !liveIds.has(a.infloww_id) && !a.missing_since)
  const back = accounts.filter((a) => liveIds.has(a.infloww_id) && a.missing_since)

  console.log(`\n${live.length} creators on the key · ${accounts.length} accounts held`)
  const list = (title, rows, line) => {
    console.log(`\n${title} (${rows.length})`)
    for (const row of rows) console.log(`  ${line(row)}`)
  }
  list('NOT YET IN earnings_accounts — run the earnings pull', unknown, (c) => `${c.id}  ${c.name}  @${c.userName}`)
  list('NO MODEL ROW — nobody on the roster owns these', unlinked, (c) => `${c.id}  ${c.name}  @${c.userName}`)
  list('GONE FROM THE KEY but still live here', vanished, (a) => `${a.infloww_id}  ${a.name}`)
  list('BACK after being missing', back, (a) => `${a.infloww_id}  ${a.name}`)
  return liveIds
}

if (!process.argv.includes('--watch')) {
  await report()
} else {
  let known = null
  for (;;) {
    try {
      if (known === null) {
        known = await report()
        console.log(`\nwatching every ${POLL_MS / 60_000} minutes — only changes print from here`)
      } else {
        const live = await listCreators(Date.now() + 90_000)
        const ids = new Set(live.map((c) => c.id))
        for (const c of live.filter((c) => !known.has(c.id))) {
          console.log(`NEW on the key: ${c.name} (@${c.userName}) ${c.id} — now ${ids.size}`)
        }
        for (const id of [...known].filter((id) => !ids.has(id))) {
          console.log(`GONE from the key: ${id} — now ${ids.size}`)
        }
        known = ids
      }
    } catch (error) {
      console.log(`check failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}
