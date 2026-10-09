import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const PORT = 3311
const CDP_PORT = 3411
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const env = await readFile('.env.local', 'utf8')
let secret = env.match(/^SESSION_SECRET=(.*)$/m)[1].trim()
if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
  secret = secret.slice(1, -1)
}
const expires = Date.now() + 3600000
const sig = createHmac('sha256', secret).update(String(expires)).digest('base64url')
const token = `${expires}.${sig}`

const profile = await mkdtemp(join(tmpdir(), 'vb-debug-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'],
  { stdio: 'ignore' },
)

let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try {
    const version = await fetch(`http://localhost:${CDP_PORT}/json/version`).then((r) => r.json())
    wsUrl = version.webSocketDebuggerUrl
  } catch {
    await sleep(300)
  }
}

const target = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then((r) => r.json())
const ws = new WebSocket(wsUrl)
await new Promise((resolve) => (ws.onopen = resolve))
let id = 0
const pending = new Map()
const events = []
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  } else if (message.method) {
    events.push(message)
  }
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve) => {
    const messageId = ++id
    pending.set(messageId, resolve)
    ws.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
const attached = await send('Target.attachToTarget', { targetId: target.id, flatten: true })
const session = attached.result.sessionId
await send('Runtime.enable', {}, session)
await send('Log.enable', {}, session)
await send('Network.enable', {}, session)
const cookieResult = await send('Network.setCookie', { name: 'tx_session', value: token, url: `http://localhost:${PORT}/`, path: '/' }, session)
console.log('setCookie result:', JSON.stringify(cookieResult.result))
const cookies = await send('Network.getAllCookies', {}, session)
console.log('cookies:', cookies.result?.cookies?.map((c) => `${c.name}@${c.domain}${c.path}`).join(', '))
await send('Page.enable', {}, session)
await send('Page.navigate', { url: `http://localhost:${PORT}/video-batcher` }, session)
await sleep(9000)

const dump = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
  return result.result?.result?.value
}

console.log('title:', await dump('document.title'))
console.log('url:', await dump('location.href'))
console.log('body len:', await dump('document.body ? document.body.innerHTML.length : -1'))
console.log('has console shell:', await dump(`Boolean(document.querySelector('.console.shell'))`))
console.log('has gold gate:', await dump(`Boolean(document.querySelector('.gate'))`))
console.log('has vb:', await dump(`Boolean(document.querySelector('.vb'))`))
console.log('engine global:', await dump('typeof window.__vbEngine'))
console.log('body head:', await dump('(document.body ? document.body.innerText : "no body").slice(0, 400)'))

console.log('--- console events ---')
for (const event of events) {
  if (event.method === 'Runtime.consoleAPICalled') {
    console.log('console:', event.params.type, event.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
  }
  if (event.method === 'Runtime.exceptionThrown') {
    console.log('EXCEPTION:', event.params.exceptionDetails?.exception?.description?.slice(0, 900) ?? event.params.exceptionDetails?.text)
  }
  if (event.method === 'Log.entryAdded') {
    console.log('log:', event.params.entry.level, event.params.entry.text?.slice(0, 300))
  }
  if (event.method === 'Network.loadingFailed') {
    console.log('net-fail:', event.params.type, event.params.errorText, event.params.blockedReason ?? '')
  }
}

ws.close()
chrome.kill()
