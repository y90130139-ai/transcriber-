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
// Follow every worker target so its exceptions and logs are visible.
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session)
await send('Page.navigate', { url: `http://localhost:${PORT}/video-batcher` }, session)
await sleep(12000)

// Enable logging on any worker target that appeared.
for (const event of events) {
  if (event.method === 'Target.attachedToTarget') {
    const childSession = event.params.sessionId
    await send('Runtime.enable', {}, childSession)
    await send('Log.enable', {}, childSession)
    await send('Runtime.runIfWaitingForDebugger', {}, childSession)
  }
}
await sleep(1000)

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
console.log(
  'engine state:',
  await dump(`(() => { const s = window.__vbEngine.store.getSnapshot(); return JSON.stringify({ engine: s.engine, detail: s.engineDetail, loadMs: s.engineLoadMs }) })()`),
)
console.log(
  'fetch worker:',
  await dump(`(async () => {
    try {
      const r = await fetch('/vb/vb-worker.js')
      return JSON.stringify({ status: r.status, corp: r.headers.get('cross-origin-resource-policy'), type: r.type, isolated: self.crossOriginIsolated })
    } catch (error) { return 'fetch failed: ' + error }
  })()`),
)
console.log(
  'probe Worker:',
  await dump(`(async () => {
    return await new Promise((resolve) => {
      try {
        const w = new Worker('/vb/vb-worker.js')
        const timer = setTimeout(() => resolve('timeout-no-event'), 5000)
        w.onerror = (e) => { clearTimeout(timer); resolve('worker error: ' + (e.message || '(no message)') + ' | filename=' + e.filename) }
        w.onmessage = () => { clearTimeout(timer); resolve('worker message (loaded ok)') }
      } catch (error) { resolve('construct threw: ' + error) }
    })
  })()`),
)
console.log('body head:', await dump('(document.body ? document.body.innerText : "no body").slice(0, 400)'))

// Full flow with visible state.
console.log(
  'add file + generate:',
  await dump(`(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    const stream = canvas.captureStream(30)
    const mimeType = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8'].find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 400_000 })
    const chunks = []
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    const stopped = new Promise((resolve) => { recorder.onstop = resolve })
    recorder.start(100)
    const start = performance.now()
    await new Promise((resolve) => {
      function frame() {
        const t = (performance.now() - start) / 1000
        ctx.fillStyle = 'hsl(' + ((t * 80) % 360) + ' 70% 45%)'
        ctx.fillRect(0, 0, 320, 240)
        if (t < 2) requestAnimationFrame(frame)
        else resolve()
      }
      frame()
    })
    recorder.stop()
    await stopped
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
    window.__vbEngine.addFiles([new File([new Blob(chunks, { type: 'video/' + ext })], 'debug.' + ext, { type: 'video/' + ext })])
    await new Promise((resolve) => setTimeout(resolve, 800))
    window.__vbEngine.setRender({ variations: 2, workers: 1 })
    window.__vbEngine.generate()
    const s = window.__vbEngine.store.getSnapshot()
    return JSON.stringify({ batch: s.batch && s.batch.status, jobs: s.jobs.length, notices: s.notices.map((n) => n.title + ': ' + (n.message || '')) })
  })()`),
)

for (let i = 0; i < 12; i += 1) {
  await sleep(5000)
  const state = await dump(`(() => {
    const s = window.__vbEngine.store.getSnapshot()
    return JSON.stringify({
      batch: s.batch ? s.batch.status : null,
      jobs: s.jobs.map((j) => j.status + (j.error ? ':' + j.error.slice(0, 60) : '')),
      outputs: s.outputs.length,
      progress: Object.values(s.progress).map((p) => Math.round((p.ratio || 0) * 100)),
      notices: s.notices.map((n) => n.title),
      engine: s.engineDetail,
    })
  })()`)
  console.log(`t+${(i + 1) * 5}s:`, state)
  if (state && state.includes('"batch":"completed"')) break
}

console.log('--- console events ---')
const requestUrls = new Map()
for (const event of events) {
  if (event.method === 'Network.requestWillBeSent') {
    requestUrls.set(event.params.requestId, event.params.request.url)
  }
  if (event.method === 'Network.loadingFailed') {
    console.log(
      'net-fail:',
      event.params.type,
      event.params.errorText,
      event.params.blockedReason ?? '',
      requestUrls.get(event.params.requestId)?.slice(0, 140) ?? '?',
    )
  }
}
for (const event of events) {
  if (event.method === 'Runtime.consoleAPICalled') {
    console.log('console:', event.params.type, event.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
  }
  if (event.method === 'Runtime.exceptionThrown') {
    console.log('EXCEPTION:', event.params.exceptionDetails?.exception?.description?.slice(0, 900) ?? event.params.exceptionDetails?.text)
  }
  if (event.method === 'Log.entryAdded') {
    console.log('log:', event.params.entry.level, event.params.entry.text?.slice(0, 300), event.params.entry.url?.slice(0, 120) ?? '')
  }
}

ws.close()
chrome.kill()
