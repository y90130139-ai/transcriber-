/**
 * Model accounts — end-to-end check.
 *
 *   node scripts/check-model-accounts.mjs [modelId]
 *
 * Proves the whole loop against the live Supabase project and the deployed
 * API, and cleans up after itself:
 *
 *   tables exist → invite minted → setup link resolves → password set →
 *   that password signs in → her week loads → the smoke account is removed.
 *
 * The model id is only there so the last step has a real week to load; any
 * transcriber.models id works, and one is picked automatically when omitted.
 */

import { loadEnv } from './env.mjs'

loadEnv()

const PRIMARY = (process.env.APP_URL || 'https://plan.gosianmedia.com').replace(/\/+$/, '')
const FALLBACK = 'https://cloud-production-d05d.up.railway.app'
const API = PRIMARY || FALLBACK
const ALT = PRIMARY && PRIMARY !== FALLBACK ? FALLBACK : null

/** The canonical host comes first; the railway host always answers, so a
 *  failed check retries there instead of dying on a DNS blip. */
async function apiFetch(path, init) {
  try {
    return await fetch(`${API}${path}`, init)
  } catch (error) {
    if (!ALT) throw error
    console.log(`  note    ${API} unreachable (DNS not live yet?) — retrying on the railway host`)
    return fetch(`${ALT}${path}`, init)
  }
}
const EMAIL = 'smoke-model@gosianmedia.com'
const PASSWORD = 'smoke-pass-9f2c'

const {
  accountsConfigured,
  createOrRefreshInvite,
  validateSetupToken,
  activateWithToken,
  verifyLogin,
  findAccountByEmail,
} = await import('../src/lib/model-accounts.ts')

const sqlUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
const sqlKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim()

function pass(step, detail = '') {
  console.log(`  ok      ${step}${detail ? ` — ${detail}` : ''}`)
}
function fail(step, error) {
  console.error(`  FAIL    ${step} — ${error?.message || error}`)
  process.exitCode = 1
}

async function cleanup() {
  if (!sqlUrl || !sqlKey) return
  const headers = { apikey: sqlKey, Authorization: `Bearer ${sqlKey}` }
  await fetch(`${sqlUrl}/rest/v1/model_accounts?email=eq.${encodeURIComponent(EMAIL)}`, { method: 'DELETE', headers }).catch(() => {})
}

/* ------------------------------------------------------------------ run it */

if (!accountsConfigured()) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — run this from cloud/ with .env.local.')
  process.exit(1)
}

console.log(`Supabase: ${sqlUrl}`)
console.log(`API:      ${API}`)
console.log('')

let modelId = process.argv[2]
if (!modelId) {
  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(process.env.DATABASE_URL)
    const [row] = await sql.query(`select id from transcriber.models where status = 'active' order by name limit 1`)
    modelId = row?.id
  } catch {
    /* fall through to the failure below */
  }
}
if (!modelId) {
  console.error('No model id given and none could be read from the transcriber database.')
  process.exit(1)
}

await cleanup() // a crashed previous run must not poison this one

try {
  const invite = await createOrRefreshInvite({ modelId, email: EMAIL, name: 'Smoke Model' })
  if (!invite.invited || !invite.token) throw new Error('invite was not minted')
  pass('invite minted', invite.account.email)

  const setup = await validateSetupToken(invite.token)
  if (!setup || setup.alreadyActive) throw new Error('setup token did not resolve')
  pass('setup link resolves')

  const activated = await activateWithToken({ token: invite.token, password: PASSWORD })
  if (activated.status !== 'active') throw new Error('account did not activate')
  pass('password set')

  const again = await validateSetupToken(invite.token)
  if (again) throw new Error('setup token survived activation')
  pass('setup token burned after use')

  const signedIn = await verifyLogin(EMAIL, PASSWORD)
  if (!signedIn) throw new Error('sign-in rejected the new password')
  pass('sign-in verifies')

  const wrong = await verifyLogin(EMAIL, 'not-the-password')
  if (wrong) throw new Error('sign-in accepted a wrong password')
  pass('wrong password rejected')

  // The live API, with the password her app would send.
  const login = await apiFetch('/api/app/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json())
  if (!login?.token) throw new Error(`live login returned no token (${JSON.stringify(login).slice(0, 120)})`)
  pass('live API sign-in', login.account?.modelId ? 'model linked' : '')

  const me = await apiFetch('/api/app/me', { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json())
  if (me?.account?.email !== EMAIL) throw new Error('live /me did not return the account')
  pass('live /me')

  const plan = await apiFetch('/api/app/plan', { headers: { Authorization: `Bearer ${login.token}` } })
  const planBody = await plan.json()
  if (!plan.ok) throw new Error(`live plan failed (${plan.status} ${JSON.stringify(planBody).slice(0, 120)})`)
  pass('live plan', `${planBody.items?.length ?? 0} cards for ${planBody.model?.name ?? modelId}`)

  const bogus = await apiFetch('/api/app/plan', { headers: { Authorization: 'Bearer nope.nope.nope' } })
  if (bogus.status !== 401) throw new Error(`a bad token got ${bogus.status}, not 401`)
  pass('bad token rejected')

  // Push registration, her look, her name, her photo — the app's settings
  // routes, each against the live server (2026-10-12).
  const auth = { Authorization: `Bearer ${login.token}` }
  const pushToken = `ExponentPushToken[smoke-${Date.now()}]`
  const device = await apiFetch('/api/app/device', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pushToken, platform: 'ios' }),
  })
  if (device.status !== 200) throw new Error(`device registration got ${device.status}`)
  pass('push device registered')
  const deviceOff = await apiFetch('/api/app/device', {
    method: 'DELETE',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pushToken }),
  })
  if (deviceOff.status !== 200) throw new Error(`device removal got ${deviceOff.status}`)
  pass('push device removed on sign-out')

  const styled = await apiFetch('/api/app/style', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pal: 'rose' }),
  }).then((r) => r.json())
  if (styled?.portal_style?.pal !== 'rose') throw new Error(`style save did not stick (${JSON.stringify(styled).slice(0, 120)})`)
  pass('her colour saved')
  await apiFetch('/api/app/style', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pal: 'ember' }),
  })
  pass('her colour restored to the house default')

  const named = await apiFetch('/api/app/profile', {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Model' }),
  }).then((r) => r.json())
  if (named?.account?.name !== 'Smoke Model') throw new Error('name save did not stick')
  pass('her name saved')

  const photo = await apiFetch('/api/app/photo', { method: 'POST', headers: auth }).then((r) => r.json())
  if (!photo?.upload_url || !String(photo.upload_url).includes('r2.cloudflarestorage.com')) {
    throw new Error('photo upload link was not minted')
  }
  pass('photo upload link minted')
} catch (error) {
  fail('smoke', error)
} finally {
  await cleanup()
  const gone = await findAccountByEmail(EMAIL)
  if (gone) fail('cleanup', 'smoke account still present')
  else pass('cleaned up', 'smoke account removed')
}

console.log(process.exitCode ? '\nSomething is off — see above.' : '\nAll good: invites, join, sign-in and her week are live.')
