// One Reddit collection pass, runnable from anywhere without the console:
//
//   npm run reddit:pull -- --test              # credentials + one read-only request
//   npm run reddit:pull -- --validate          # validate queued communities (/about)
//   npm run reddit:pull                        # collect + one requirements pass
//   npm run reddit:pull -- 20                  # collect with an explicit request budget
//   npm run reddit:pull -- --requirements      # requirements board pass only
//   npm run reddit:pull -- --no-requirements   # trend collection only
//
// The collector itself enforces the rate-limit rules (one request at a
// time, paced by Reddit's x-ratelimit headers at the configured safety
// ratio, circuit breaker on repeated 429/403), so this script can be run
// as often as a scheduler wants.
import { loadEnv } from './env.mjs'

loadEnv()
const { collect, collectRequirements, testConnection } = await import('../src/lib/reddit/collect.ts')

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

const requirementsOnly = wants('requirements') && !wants('validate')
const requirementsBudget = budget ?? 20

if (requirementsOnly) {
  const result = await collectRequirements({ trigger: 'cron', budget: requirementsBudget })
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
if (!wants('no-requirements') && !wants('validate')) {
  requirements = await collectRequirements({ trigger: 'cron', budget: requirementsBudget }).catch((error) => ({
    state: 'failed',
    reason: error instanceof Error ? error.message : String(error),
  }))
  console.log(JSON.stringify({ requirements }, null, 2))
}

const failed = result.state === 'failed' || (requirements && requirements.state === 'failed' && !requirements.reason?.includes('disabled'))
process.exit(failed ? 1 : 0)
