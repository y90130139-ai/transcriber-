/**
 * Capture a burner's Instagram session on THIS computer, for the Railway worker.
 *
 * Uses the Chrome already installed here (no bundled browser download): a real
 * window opens on a dedicated profile, you sign in to the burner by hand and
 * answer whatever Instagram asks, and this waits until the session is really
 * usable — a `sessionid` cookie AND a page that is not one of Instagram's
 * half-finished sign-in paths — then writes:
 *
 *   secrets/ig-cookies.txt   Netscape jar — the worker's IG_COOKIES_B64
 *   secrets/ig-state.json    Playwright storage state — the optional IG_STATE_B64
 *
 * and prints both base64-encoded, ready to paste into Railway. The scrape
 * itself is untouched: the worker runs the same reader the Mac ran; only where
 * the cookie lives changes.
 *
 *   cd worker
 *   npm install                     (once — installs puppeteer-core)
 *   node capture_cookies.mjs
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'secrets')
// `node capture_cookies.mjs` → the primary burner; `… backup` → the backup.
// Each label gets its own files and its own Chrome profile, so capturing the
// backup can never overwrite — or even reuse the session of — the primary.
const label = (process.argv[2] ?? 'main').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'main'
const suffix = label === 'main' ? '' : `-${label}`
const JAR = join(OUT, `ig-cookies${suffix}.txt`)
const STATE = join(OUT, `ig-state${suffix}.json`)
const PROFILE = join(here, 'data', label === 'main' ? 'capture-profile' : `capture-${label}-profile`)
const JAR_ENV = label === 'main' ? 'IG_COOKIES_B64' : `IG_COOKIES_${label.toUpperCase()}_B64`
const STATE_ENV = label === 'main' ? 'IG_STATE_B64' : `IG_STATE_${label.toUpperCase()}_B64`

const LOGIN_URL = 'https://www.instagram.com/accounts/login/'
const WAIT_MS = 15 * 60_000
const POLL_MS = 2000
const UNFINISHED = ['/accounts/login', '/challenge', '/two_factor', '/accounts/onetap', '/auth_platform']

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chrome) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to the executable.')
  process.exit(1)
}

/** The Netscape jar format http.cookiejar reads on the worker. */
function jarFor(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Written by capture_cookies.mjs', '']
  for (const cookie of cookies) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`
    const expires = cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : 0
    lines.push([
      domain, 'TRUE', cookie.path || '/', cookie.secure ? 'TRUE' : 'FALSE',
      String(expires), cookie.name, cookie.value,
    ].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

/** Playwright's storage_state shape (what `add_cookies`/`storage_state` take). */
function stateFor(cookies) {
  return {
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`,
      path: cookie.path || '/',
      expires: cookie.expires ?? -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax' || cookie.sameSite === 'None'
        ? cookie.sameSite : 'Lax',
    })),
    origins: [],
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const signedIn = (cookies, url) =>
  cookies.some((cookie) => cookie.name === 'sessionid' && cookie.domain.includes('instagram.com')) &&
  !UNFINISHED.some((part) => url.includes(part))

mkdirSync(OUT, { recursive: true })
mkdirSync(PROFILE, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: { width: 1280, height: 800 },
})

const page = (await browser.pages())[0] ?? (await browser.newPage())
await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

console.log('Sign in to the burner in the window that just opened.')
console.log('Answer any challenge/2FA by hand — nothing is automated while you do.')
console.log(`Waiting up to ${WAIT_MS / 60_000} minutes for a real session...`)

const client = await page.createCDPSession()
const deadline = Date.now() + WAIT_MS
let done = false
while (Date.now() < deadline && !done) {
  const { cookies } = await client.send('Network.getAllCookies')
  if (signedIn(cookies, page.url())) {
    writeFileSync(JAR, jarFor(cookies))
    writeFileSync(STATE, JSON.stringify(stateFor(cookies), null, 2))
    try { chmodSync(JAR, 0o600); chmodSync(STATE, 0o600) } catch { /* Windows: best effort */ }
    console.log('\nSession captured.')
    console.log(`  label ${label}`)
    console.log(`  jar   ${JAR}`)
    console.log(`  state ${STATE}\n`)
    console.log('Railway env — paste each whole line:\n')
    console.log(`${JAR_ENV}=${Buffer.from(readFileSync(JAR)).toString('base64')}\n`)
    console.log(`${STATE_ENV}=${Buffer.from(readFileSync(STATE)).toString('base64')}\n`)
    done = true
    break
  }
  await sleep(POLL_MS)
}

await browser.close()
if (!done) {
  console.error('Timed out before a usable session appeared. Nothing was written.')
  process.exit(1)
}
