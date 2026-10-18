// Read-only verification of the live daily creator/content refresh.
// Usage: node scripts/scout-status.mjs [https://plan.gosianmedia.com]
import { loadEnv } from './env.mjs'

loadEnv()
const origin = (process.argv[2] || 'https://plan.gosianmedia.com').replace(/\/$/, '')
if (!process.env.WORKER_SECRET) throw new Error('WORKER_SECRET is not set')

async function read(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WORKER_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}

const [targets, monitor, ofmpro] = await Promise.all([
  read('/api/scout/targets', {}),
  read('/api/scout/monitor', { scraping_enabled: true }),
  read('/api/worker/ofmpro/state?downloads=1'),
])

console.log(JSON.stringify({
  origin,
  creators: targets.creators?.length ?? 0,
  model_accounts: targets.mine?.length ?? 0,
  winner_window_days: targets.window_days,
  freshness: monitor,
  ofmpro: {
    coverage: ofmpro.coverage,
    totals: ofmpro.totals,
    last_run: ofmpro.lastRun,
  },
}, null, 2))
