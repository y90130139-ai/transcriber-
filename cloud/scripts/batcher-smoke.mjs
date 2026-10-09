/**
 * Video Batcher smoke test — the definition of done, automated.
 *
 * Boots the built app, drives a headless Chrome through CDP, and proves the
 * whole vertical path with a real video:
 *
 *   page loads → engine ready → a recording is synthesized in-page →
 *   probe → 2 deterministic variations → worker renders → OPFS output →
 *   the output is a real MP4 (ftyp magic) → the console's other pages still
 *   serve (nothing broke).
 *
 * Usage: node scripts/batcher-smoke.mjs [--port 3111] [--keep]
 */
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 3111
const KEEP = args.includes('--keep')
const CDP_PORT = PORT + 100

/** Windows trees need taskkill; a bare kill leaves orphans. */
function killTree(child) {
  if (!child?.pid) return
  try {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function log(step, message) {
  console.log(`[smoke] ${step.padEnd(22)} ${message}`)
}

async function findBrowser() {
  const { access } = await import('node:fs/promises')
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate)
      return candidate
    } catch {
      /* next */
    }
  }
  throw new Error('no Chrome/Edge found')
}

/* ------------------------------------------------------------- session */

async function sessionToken() {
  const env = await readFile(join(root, '.env.local'), 'utf8')
  let secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim()
  if (!secret) throw new Error('SESSION_SECRET missing from .env.local')
  // Next's env loader strips surrounding quotes; the raw line keeps them.
  if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
    secret = secret.slice(1, -1)
  }
  const expires = Date.now() + 3600_000
  const signature = createHmac('sha256', secret).update(String(expires)).digest('base64url')
  return `${expires}.${signature}`
}

/* --------------------------------------------------------------- server */

function startServer() {
  // Node 24 refuses to spawn .cmd shims without a shell; call the CLI's own
  // entry script with the current node instead — no shell, no escaping.
  const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
    if (/error/i.test(text)) console.error(`[smoke] server: ${text.trim()}`)
  })
  return child
}

async function assertPortFree() {
  try {
    await fetch(`http://localhost:${PORT}/video-batcher`, { signal: AbortSignal.timeout(1500) })
  } catch {
    return
  }
  throw new Error(`port ${PORT} already serves something — stop it or pass --port`)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://localhost:${PORT}/video-batcher`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('next start did not come up')
}

/* ------------------------------------------------------------------ CDP */

class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  #session = null

  static async connect(wsUrl) {
    const client = new Cdp()
    client.#ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      client.#ws.onopen = resolve
      client.#ws.onerror = reject
    })
    client.#ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && client.#pending.has(message.id)) {
        const { resolve, reject } = client.#pending.get(message.id)
        client.#pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message}`))
        else resolve(message.result)
      }
    }
    return client
  }

  send(method, params = {}, sessionId = this.#session) {
    const id = ++this.#id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 180_000)
    })
  }

  async attach(url) {
    const target = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    }).then((response) => response.json())
    const attached = await this.send('Target.attachToTarget', { targetId: target.id, flatten: true }, null)
    this.#session = attached.sessionId
    return target
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }

  close() {
    try {
      this.#ws.close()
    } catch {
      /* already closed */
    }
  }
}

async function waitForCdp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const version = await fetch(`http://localhost:${CDP_PORT}/json/version`).then((r) => r.json())
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(400)
  }
  throw new Error('chrome devtools endpoint never opened')
}

/* ----------------------------------------------------------------- main */

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  log(ok ? 'PASS' : 'FAIL', `${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const browser = await findBrowser()
  const token = await sessionToken()

  log('server', `starting next start on :${PORT}`)
  await assertPortFree()
  const server = startServer()
  let chrome
  let cdp
  try {
    await waitForServer()

    const profile = await mkdtemp(join(tmpdir(), 'vb-smoke-'))
    chrome = spawn(
      browser,
      [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--autoplay-policy=no-user-gesture-required',
        'about:blank',
      ],
      { stdio: 'ignore' },
    )

    const wsUrl = await waitForCdp()
    cdp = await Cdp.connect(wsUrl)
    await cdp.attach(`http://localhost:${PORT}/video-batcher`)

    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Network.setCookie', {
      name: 'tx_session',
      value: token,
      url: `http://localhost:${PORT}/`,
      path: '/',
    })
    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/video-batcher` })
    await sleep(2500)

    // 1. The page rendered inside the console shell.
    const shell = await cdp.evaluate(`Boolean(document.querySelector('.console.shell .vb'))`)
    check('page renders inside the console shell', shell === true)

    // 2. The engine reached ready without a click.
    const readyStart = Date.now()
    let engine = null
    while (Date.now() - readyStart < 150_000) {
      engine = await cdp.evaluate(
        `window.__vbEngine ? window.__vbEngine.store.getSnapshot().engine : null`,
      )
      if (engine === 'ready' || engine === 'error' || engine === 'limited') break
      await sleep(500)
    }
    check('processing engine ready', engine === 'ready', `state=${engine} after ${Date.now() - readyStart}ms`)

    // 3. Synthesize a real video in-page.
    const made = await cdp.evaluate(`(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const ctx = canvas.getContext('2d')
      const stream = canvas.captureStream(30)
      const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm']
      const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) return { error: 'no MediaRecorder mime' }
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 700_000 })
      const chunks = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      const stopped = new Promise((resolve) => { recorder.onstop = resolve })
      recorder.start(100)
      const start = performance.now()
      await new Promise((resolve) => {
        function frame() {
          const t = (performance.now() - start) / 1000
          ctx.fillStyle = 'hsl(' + ((t * 80) % 360) + ' 70% 45%)'
          ctx.fillRect(0, 0, 640, 360)
          ctx.fillStyle = '#fff'
          ctx.font = 'bold 48px sans-serif'
          ctx.fillText(t.toFixed(1) + 's', 40, 200)
          if (t < 3) requestAnimationFrame(frame)
          else resolve()
        }
        frame()
      })
      recorder.stop()
      await stopped
      const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
      const file = new File([blob], 'smoke.' + ext, { type: mimeType.split(';')[0] })
      window.__vbEngine.addFiles([file])
      return { mimeType, size: blob.size, ext }
    })()`)
    check('test video synthesized', !made?.error, made?.error ?? `${made.ext} ${made.size} bytes`)

    // 4. Probe completes fast and without touching the UI thread's job work.
    const probeStart = Date.now()
    let source = null
    while (Date.now() - probeStart < 60_000) {
      source = await cdp.evaluate(`(async () => {
        const state = window.__vbEngine.store.getSnapshot().sources[0]
        return state ? { status: state.status, probe: state.probe, error: state.error } : null
      })()`)
      if (source && (source.status === 'ready' || source.status === 'error')) break
      await sleep(250)
    }
    check('source probed', source?.status === 'ready', `${Date.now() - probeStart}ms · ${source?.probe ? `${source.probe.width}x${source.probe.height} ${source.probe.videoCodec}/${source.probe.audioCodec ?? 'no audio'} via ${source.probe.source}` : source?.error}`)
    if (source?.status !== 'ready') throw new Error(`probe failed: ${source?.error}`)

    // 5. Two deterministic variations; first output ASAP.
    await cdp.evaluate(`(() => {
      window.__vbEngine.setRender({ variations: 2, workers: 2 })
      window.__vbEngine.generate()
      return true
    })()`)

    const firstStart = Date.now()
    let firstOutputMs = null
    let batches = null
    while (Date.now() - firstStart < 420_000) {
      const state = await cdp.evaluate(`(() => {
        const snapshot = window.__vbEngine.store.getSnapshot()
        return {
          outputs: snapshot.outputs.length,
          status: snapshot.batch?.status ?? null,
          completed: snapshot.stats?.completed ?? 0,
          failed: snapshot.stats?.failed ?? 0,
          overall: snapshot.stats?.overall ?? 0,
        }
      })()`)
      if (state.outputs > 0 && firstOutputMs == null) {
        firstOutputMs = Date.now() - firstStart
        log('progress', `first output available after ${firstOutputMs}ms`)
      }
      if (state.status === 'completed' || state.status === 'partial' || state.status === 'failed' || state.status === 'cancelled') {
        batches = state
        break
      }
      await sleep(700)
    }
    check('first output surfaced before the batch finished', firstOutputMs != null, firstOutputMs ? `${firstOutputMs}ms` : 'never')
    check('batch completed both variations', batches?.status === 'completed', JSON.stringify(batches))

    // 6. The output bytes are a real MP4 written to OPFS.
    const fileCheck = await cdp.evaluate(`(async () => {
      const output = window.__vbEngine.store.getSnapshot().outputs[0]
      if (!output) return { error: 'no output record' }
      const root = await navigator.storage.getDirectory()
      const dir = await (await root.getDirectoryHandle('vb-exports')).getDirectoryHandle(output.batchId)
      const file = await (await dir.getFileHandle(output.fileName)).getFile()
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
      return {
        size: file.size,
        magic: String.fromCharCode(...head.slice(4, 8)),
        name: output.fileName,
        recordedBytes: output.sizeBytes,
      }
    })()`)
    check(
      'output is a valid MP4 in OPFS',
      fileCheck?.magic === 'ftyp' && fileCheck.size > 10_000 && fileCheck.size === fileCheck.recordedBytes,
      `${fileCheck?.name} ${fileCheck?.size} bytes`,
    )

    // 7. The rest of the console still serves (nothing broke).
    const library = await fetch(`http://localhost:${PORT}/`, {
      headers: { cookie: `tx_session=${token}` },
    })
    const queue = await fetch(`http://localhost:${PORT}/queue`, {
      headers: { cookie: `tx_session=${token}` },
    })
    check('console pages still serve', library.ok && queue.ok, `home=${library.status} queue=${queue.status}`)

    log('done', 'closing up')
  } finally {
    cdp?.close()
    if (!KEEP) {
      killTree(chrome)
      killTree(server)
    }
  }

  const failed = results.filter((result) => !result.ok)
  console.log('')
  console.log(`[smoke] ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.error(`[smoke] FAILED: ${failed.map((result) => result.name).join('; ')}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[smoke] fatal: ${error.stack ?? error}`)
  process.exit(1)
})
