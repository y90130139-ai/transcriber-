// One Reddit collection pass, runnable from anywhere without the console:
//
//   npm run reddit:pull -- --test              # credentials + one read-only request
//   npm run reddit:pull -- --validate          # validate queued communities (/about)
//   npm run reddit:pull                        # collect + requirements + discovery (when due)
//   npm run reddit:pull -- 20                  # collect with an explicit request budget
//   npm run reddit:pull -- --requirements      # requirements board pass only
//   npm run reddit:pull -- --discover          # NSFW discovery sweep only
//   npm run reddit:pull -- --no-requirements --no-discovery   # trend collection only
//
// The collector itself enforces the rate-limit rules (one request at a
// time, paced by Reddit's x-ratelimit headers at the configured safety
// ratio, circuit breaker on repeated 429/403), so this script can be run
// as often as a scheduler wants.
import { loadEnv } from './env.mjs'

loadEnv()
const { collect, collectRequirements, collectDiscovery, testConnection } = await import('../src/lib/reddit/collect.ts')
const { discoveryDue } = await import('../src/lib/reddit/requirementStore.ts')
const { getSettings } = await import('../src/lib/reddit/settings.ts')

// Flags are accepted in every shape a shell actually delivers them:
// PowerShell strips the `--` separator, so `npm run reddit:pull -- --test`
// arrives as an npm config env var, while cmd passes the flag through and a
// bare word survives both. All three mean the same thing.
const args = process.argv.slice(2)
const env = process.env
const wants = (name) =>
  args.includes(`--${name}`) || args.includes(name) || env[`npm_config_${name}`] === 'true'

const budgetArg = args.find((arg) => /^\d+$/.test(arg))
const budgetValue = budgetArg ?? env.npm_config_budget
const budget = budgetValue && /^\d+$/.test(budgetValue) ? Number(budgetValue) : undefined

if (wants('test')) {
  const result = await testConnection()
  console.log(result.ok ? `ok: ${result.detail} (${result.ms}ms, remaining=${result.remaining})` : `failed: ${result.detail}`)
  process.exit(result.ok ? 0 : 1)
}

const settings = await getSettings()

if (wants('discover') && !wants('requirements') && !wants('validate')) {
  const result = await collectDiscovery({ trigger: 'cron', budget: budget ?? settings.discovery_per_pass })
  console.log(JSON.stringify({ discovery: result }, null, 2))
  process.exit(result.state === 'failed' ? 1 : 0)
}

if (wants('requirements') && !wants('validate')) {
  const result = await collectRequirements({ trigger: 'cron', budget: budget ?? 20 })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.state === 'failed' ? 1 : 0)
}

const trigger = wants('validate') ? 'validation' : 'manual'
const result = await collect({ trigger, budget })
console.log(JSON.stringify(result, null, 2))

// The requirements board rides the same invocation — each pass is bounded
// by its own budget and the shared daily cap, and a failed pass never
// fails the trend collection that already landed.
let requirements = null
let discovery = null
if (!wants('validate')) {
  if (!wants('no-requirements')) {
    requirements = await collectRequirements({ trigger: 'cron', budget: budget ?? 20 }).catch((error) => ({
      state: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }))
    console.log(JSON.stringify({ requirements }, null, 2))
  }
  if (!wants('no-discovery') && await discoveryDue().catch(() => false)) {
    discovery = await collectDiscovery({ trigger: 'cron', budget: settings.discovery_per_pass }).catch((error) => ({
      state: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }))
    console.log(JSON.stringify({ discovery }, null, 2))
  }
}

const failed = result.state === 'failed' || (requirements && requirements.state === 'failed' && !requirements.reason?.includes('disabled'))
process.exit(failed ? 1 : 0)
