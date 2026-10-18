// End-to-end local benchmark for the Social Transcriber Video Batcher.
// Usage (from cloud/):
//   node --env-file=.env.local test/video-batcher.full-benchmark.mjs
// The runner drives a dedicated headless Chrome profile over CDP, signs a
// short-lived local test session, and writes its reports/artifacts to E:\testing.
import assert from 'node:assert/strict'
import { createHmac, createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { cpus, totalmem } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const CLOUD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_DIR = path.resolve(CLOUD_DIR, '..')
const VIDEO_PATH = process.env.BENCHMARK_VIDEO_PATH
  ?? 'C:\\Users\\PC\\Downloads\\008_msg-49_IMG_1267_v001_l7x80_8594ea919200.webm'
const IMAGE_PATH = process.env.BENCHMARK_IMAGE_PATH
  ?? 'C:\\Users\\PC\\Downloads\\ME953176051bb3a8427d149db9a204b856.jpeg'
// Match the origin used by the local Next dev server; 127.0.0.1 makes Next 16
// reject its own localhost HMR stream as cross-origin and can delay hydration.
const BASE_URL = (process.env.VIDEO_BATCHER_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const OUTPUT_DIR = process.env.BENCHMARK_OUTPUT_DIR
  ?? path.join('E:\\testing', `social-transcriber-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const CHROME_PATH = process.env.CHROME_BIN
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TAB_IDS = ['effects', 'captions', 'audio', 'metadata', 'watermark', 'converter', 'compressor', 'downloads']
const CONVERTER_TARGETS = ['keep', 'mp4', 'webm', 'mkv', 'mov', 'gif', 'mp3', 'm4a', 'wav', 'jpg', 'png', 'webp']
const TARGET_LABELS = {
  keep: 'As recorded', mp4: 'MP4', webm: 'WebM', mkv: 'MKV', mov: 'MOV', gif: 'GIF',
  mp3: 'MP3', m4a: 'M4A', wav: 'WAV', jpg: 'JPG', png: 'PNG', webp: 'WebP',
}
const QUALITY_BY_TARGET = { keep: 'Clarity', mp4: 'Balanced', webm: 'Smallest', mkv: 'Balanced', mov: 'Balanced', gif: 'Balanced', mp3: 'Smallest', m4a: 'Balanced', wav: 'Clarity', jpg: 'Balanced', png: 'Clarity', webp: 'Smallest' }

const stamp = new Date().toISOString()
const report = {
  startedAt: stamp,
  completedAt: null,
  outputDirectory: OUTPUT_DIR,
  app: { baseUrl: BASE_URL, route: `${BASE_URL}/video-batcher/effects` },
  environment: { node: process.version, platform: process.platform, cpuLogicalCores: cpus().length, totalMemoryBytes: totalmem() },
  inputs: {},
  unitTests: null,
  routes: [],
  checks: [],
  batches: [],
  converterMatrix: [],
  browserErrors: [],
  devServerWarnings: [],
  network: { origins: [], failedRequests: [], canceledRequests: 0, notFoundResources: [] },
  notes: [],
  fatalError: null,
}

await mkdir(OUTPUT_DIR, { recursive: true })
for (const folder of ['screenshots', 'exports', 'fixtures', 'chrome-profile']) {
  await mkdir(path.join(OUTPUT_DIR, folder), { recursive: true })
}

function check(name, passed, details = null) {
  report.checks.push({ name, passed: Boolean(passed), details })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${details ? ` — ${typeof details === 'string' ? details : JSON.stringify(details)}` : ''}`)
  return Boolean(passed)
}

async function saveReports() {
  report.completedAt = new Date().toISOString()
  const resultsPath = path.join(OUTPUT_DIR, 'results.json')
  const rows = report.batches.flatMap((batch) => batch.jobs.map((job) => ({
    batch: batch.name,
    variationCount: batch.requestedVariations,
    batchWallMs: batch.wallMs,
    source: job.sourceName,
    variationIndex: job.variationIndex,
    status: job.status,
    output: job.outputName,
    outputBytes: job.outputBytes,
    outputMime: job.outputMime,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    outputDuration: job.outputDuration,
    elapsedMs: job.elapsedMs,
    warnings: (job.warnings ?? []).join(' | '),
    error: job.error ?? '',
  })))
  const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [
    ['batch', 'variationCount', 'batchWallMs', 'source', 'variationIndex', 'status', 'output', 'outputBytes', 'outputMime', 'outputWidth', 'outputHeight', 'outputDuration', 'elapsedMs', 'warnings', 'error'].join(','),
    ...rows.map((row) => Object.values(row).map(csvCell).join(',')),
  ].join('\n')
  await writeFile(resultsPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(path.join(OUTPUT_DIR, 'batches.csv'), `${csv}\n`, 'utf8')

  const passed = report.checks.filter((item) => item.passed).length
  const failed = report.checks.length - passed
  const batches = report.batches.map((batch) => {
    const successful = batch.jobs.filter((job) => job.status === 'completed').length
    const fallback = batch.jobs.filter((job) => job.status === 'fallback').length
    const warnings = batch.jobs.reduce((sum, job) => sum + (job.warnings?.length ?? 0), 0)
    const mean = batch.jobs.length
      ? Math.round(batch.jobs.reduce((sum, job) => sum + (job.elapsedMs ?? 0), 0) / batch.jobs.length)
      : null
    return `| ${batch.name} | ${batch.requestedVariations} | ${batch.jobs.length} | ${batch.maxConcurrentRenders ?? '—'} | ${successful} | ${fallback} | ${formatMs(batch.wallMs)} | ${formatMs(mean)} | ${warnings} |`
  })
  const matrixRows = report.converterMatrix.map((entry) =>
    `| ${entry.mediaKind} | ${entry.target} | ${entry.status} | ${entry.outputMime ?? '—'} | ${formatMs(entry.elapsedMs)} | ${entry.warningCount} | ${entry.downloaded ? 'yes' : 'no'} |`,
  )
  const routeRows = report.routes.map((route) => `| ${route.tab} | ${route.heading ?? '—'} | ${route.loaded ? 'PASS' : 'FAIL'} |`)
  const unit = report.unitTests
    ? `${report.unitTests.passed ?? 'n/a'} passed, ${report.unitTests.failed ?? 'n/a'} failed, exit code ${report.unitTests.exitCode}`
    : 'Not run'
  const inputRows = Object.entries(report.inputs).map(([kind, input]) =>
    `| ${kind} | ${input.fileName} | ${input.sizeBytes} | ${input.sha256} | ${input.mediaInfo ?? '—'} |`,
  )
  const warnings = report.batches.flatMap((batch) => batch.jobs.flatMap((job) =>
    (job.warnings ?? []).map((warning) => `- **${batch.name} / ${job.outputName ?? job.sourceName}:** ${warning}`),
  ))
  const featureRows = report.checks.map((item) => `| ${item.passed ? 'PASS' : 'FAIL'} | ${item.name} | ${typeof item.details === 'string' ? item.details : item.details ? JSON.stringify(item.details) : ''} |`)
  const content = [
    '# Social Transcriber Studio — Video Batcher benchmark',
    '',
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    `- App: ${BASE_URL}/video-batcher/effects (local browser processing)`,
    `- Browser: ${report.environment.browser ?? 'Chrome headless'}`,
    `- Host: ${report.environment.cpuLogicalCores} logical cores, ${(report.environment.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB RAM, ${report.environment.platform}, ${report.environment.node}`,
    `- Automated checks: **${passed} passed / ${failed} failed**`,
    `- Existing unit suite: **${unit}**`,
    '',
    '## Supplied media',
    '',
    '| Kind | File | Bytes | SHA-256 | Browser inspection |',
    '|---|---|---:|---|---|',
    ...inputRows,
    '',
    '## Variation scaling runs',
    '',
    '| Batch | Requested variations per source | Jobs | Render concurrency | Clean | Fallback | Wall time | Mean render/output time | Warning count |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...batches,
    '',
    'Timing is from the app’s per-job `elapsedMs` (including local render, decode verification and any configured metadata/conversion pass) and wall time from Generate to terminal status. Canvas renders are bounded in parallel (up to 2 video jobs or 4 image jobs on this host); FFmpeg export passes remain serialized.',
    '',
    '## Converter / compressor matrix',
    '',
    '| Input kind | Target | Status | Output MIME | Render time | Warnings | Downloaded |',
    '|---|---|---|---|---:|---:|---|',
    ...matrixRows,
    '',
    'Targets that do not apply to still images are expected to retain the still output and show an explanatory warning. Any converter-load or conversion warning is reported below and is not counted as a clean conversion pass.',
    '',
    '## Route and feature checks',
    '',
    '| Workspace | Heading | Result |',
    '|---|---|---|',
    ...routeRows,
    '',
    '| Result | Check | Details |',
    '|---|---|---|',
    ...featureRows,
    '',
    '## Output warnings',
    '',
    ...(warnings.length ? warnings : ['None.']),
    '',
    '## Runtime/network notes',
    '',
    `- External origins seen by the benchmark browser: ${report.network.origins.length ? report.network.origins.join(', ') : 'none'}.`,
    `- Failed network requests: ${report.network.failedRequests.length}.`,
    `- Expected local media cancellations while switching/clearing previews: ${report.network.canceledRequests}.`,
    `- Non-blocking 404 resources: ${report.network.notFoundResources.length}.`,
    `- Browser JavaScript errors: ${report.browserErrors.length}.`,
    `- Development-server warnings: ${report.devServerWarnings.length}.`,
    '- Source media was selected as local browser files. The harness records media hashes and result metadata; it does not copy the source files into the report directory.',
    ...report.notes.map((note) => `- ${note}`),
    ...(report.fatalError ? ['', '## Fatal runner error', '', `\`${report.fatalError}\``] : []),
    '',
    '## Files',
    '',
    '- `results.json` — complete machine-readable report and per-job output records.',
    '- `batches.csv` — flat per-output timing/status export.',
    '- `unit-tests.log` — full output of the project unit suite.',
    '- `screenshots/` — screenshots of all eight workspace routes.',
    '- `exports/` — representative and stress-run media downloads.',
    '',
  ].join('\n')
  await writeFile(path.join(OUTPUT_DIR, 'summary.md'), content, 'utf8')
}

function formatMs(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : '—'
}

async function hashInput(filePath) {
  assert.ok(existsSync(filePath), `Input does not exist: ${filePath}`)
  const bytes = await readFile(filePath)
  const info = await stat(filePath)
  return { fileName: path.basename(filePath), sizeBytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function runUnitSuite() {
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm test'], {
    cwd: CLOUD_DIR,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 12 * 1024 * 1024,
  })
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return writeFile(path.join(OUTPUT_DIR, 'unit-tests.log'), log, 'utf8').then(() => ({
    exitCode: result.status ?? 1,
    passed: Number(log.match(/ℹ pass (\d+)/)?.[1] ?? 0),
    failed: Number(log.match(/ℹ fail (\d+)/)?.[1] ?? 0),
    durationMs: Number(log.match(/ℹ duration_ms ([\d.]+)/)?.[1] ?? NaN),
    error: result.error?.message ?? null,
  }))
}

function issueSessionToken(secret) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sub: 'local-benchmark', email: 'benchmark@local.invalid', name: 'Local benchmark',
    role: 'ceo', transcriber: null, iat: now, exp: now + 60 * 60,
  })).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

const cdpPort = Number(process.env.CHROME_CDP_PORT ?? 9222)
const CDP_HTTP = `http://127.0.0.1:${cdpPort}`
let chrome = null
let socket = null
let nextCommandId = 1
const pending = new Map()
let targetId = null
const capturedWorkspaceTabs = new Set()

function cdpCommand(method, params = {}) {
  const id = nextCommandId++
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} timed out.`))
    }, 30_000)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value) },
      reject: (error) => { clearTimeout(timeout); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

function connectSocket(webSocketUrl) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(webSocketUrl)
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) {
        collectBrowserEvent(message)
        return
      }
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const waiter of pending.values()) waiter.reject(new Error('Chrome DevTools connection closed.'))
      pending.clear()
    })
  })
}

const seenOrigins = new Set()
function collectBrowserEvent(message) {
  const event = message.method
  const params = message.params ?? {}
  if (event === 'Network.requestWillBeSent') {
    try { seenOrigins.add(new URL(params.request.url).origin) } catch { /* ignore malformed URL */ }
  }
  if (event === 'Network.loadingFailed') {
    if (params.canceled || params.errorText === 'net::ERR_ABORTED') {
      report.network.canceledRequests += 1
    } else if (report.network.failedRequests.length < 250) {
      report.network.failedRequests.push({ type: params.type, errorText: params.errorText, canceled: params.canceled ?? false })
    }
  }
  if (event === 'Network.responseReceived' && params.response?.status >= 400) {
    let url = params.response.url
    try { const parsed = new URL(url); url = `${parsed.origin}${parsed.pathname}` } catch { /* ignore */ }
    if (params.response.status === 404 && url.endsWith('/favicon.ico')) {
      report.network.notFoundResources.push({ status: params.response.status, url })
    } else if (report.network.failedRequests.length < 250) {
      report.network.failedRequests.push({ status: params.response.status, url })
    }
  }
  if (event === 'Runtime.exceptionThrown' && report.browserErrors.length < 100) {
    report.browserErrors.push({ text: params.exceptionDetails?.text ?? 'Browser exception', description: params.exceptionDetails?.exception?.description?.slice(0, 2_000) ?? null })
  }
  if (event === 'Log.entryAdded' && params.entry?.level === 'error' && String(params.entry.text ?? '').includes('/_next/hmr')) {
    const warning = 'The local Next.js development HMR WebSocket handshake failed; page routes and UI still loaded.'
    if (!report.devServerWarnings.includes(warning)) report.devServerWarnings.push(warning)
  } else if (event === 'Log.entryAdded' && params.entry?.level === 'error') {
    const text = String(params.entry.text ?? '')
    let source = null
    try { source = params.entry.url ? new URL(params.entry.url).pathname : null } catch { /* ignore */ }
    if (text.includes('favicon.ico') || source === '/favicon.ico') {
      report.network.notFoundResources.push({ status: 404, url: '/favicon.ico', source: 'browser console' })
    } else if (report.browserErrors.length < 100) {
      report.browserErrors.push({ text: text.slice(0, 500) || 'Browser console error', source })
    }
  }
}

async function evaluate(expression, timeout = 20_000) {
  const result = await cdpCommand('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

async function waitForPage(predicate, timeoutMs = 20_000, message = 'Browser condition timed out.') {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(predicate)
    if (value) return value
    await delay(120)
  }
  throw new Error(message)
}

async function navigateTab(tab) {
  const route = `/video-batcher/${tab}`
  const currentPath = await evaluate('window.location.pathname')
  if (currentPath !== route) {
    const clicked = await evaluate(`(() => { const a = document.querySelector('a[href="${route}"]'); if (!a) return false; a.click(); return true; })()`)
    if (!clicked) throw new Error(`Could not find the studio navigation link for ${tab}.`)
  }
  await waitForPage(`document.querySelector('.vb-settings h2')?.textContent?.trim() === ${JSON.stringify(tab[0].toUpperCase() + tab.slice(1))}`, 60_000, `The ${tab} workspace did not load.`)
  const heading = await evaluate('document.querySelector(".vb-settings h2")?.textContent?.trim()')
  const routeResult = { tab, heading, loaded: true, screenshot: `screenshots/${tab}.png` }
  if (!capturedWorkspaceTabs.has(tab)) {
    await delay(100)
    const shot = await cdpCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(path.join(OUTPUT_DIR, 'screenshots', `${tab}.png`), Buffer.from(shot.data, 'base64'))
    capturedWorkspaceTabs.add(tab)
    report.routes.push(routeResult)
  }
  return routeResult
}

async function setFiles(selector, files) {
  // Build File objects from the actual local bytes, then use the same
  // DataTransfer + change-event route as a real file picker. This avoids
  // headless Chrome versions that populate a CDP FileList without firing the
  // React change handler.
  const filesForPage = await Promise.all(files.map(async (filePath) => {
    const bytes = await readFile(filePath)
    const info = await stat(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const type = ext === '.webm' ? 'video/webm'
      : ['.mp4', '.m4v'].includes(ext) ? 'video/mp4'
        : ext === '.mov' ? 'video/quicktime'
          : ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg'
            : ext === '.png' ? 'image/png'
              : 'application/octet-stream'
    return { name: path.basename(filePath), type, lastModified: Math.floor(info.mtimeMs), base64: bytes.toString('base64') }
  }))
  const populated = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return null;
    const transfer = new DataTransfer();
    for (const item of ${JSON.stringify(filesForPage)}) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], item.name, { type: item.type, lastModified: item.lastModified }));
    }
    input.files = transfer.files;
    const count = transfer.files.length;
    const assignedCount = input.files?.length ?? 0;
    const reactKey = Object.getOwnPropertyNames(input).find((key) => key.startsWith('__reactProps$'));
    const onChange = reactKey ? input[reactKey]?.onChange : null;
    const propKeys = reactKey ? Object.keys(input[reactKey] ?? {}) : [];
    if (typeof onChange === 'function') onChange({ currentTarget: input, target: input });
    return { count, assignedCount, names: ${JSON.stringify(filesForPage.map((file) => file.name))}, reactKey: reactKey ?? null, propKeys, onChangeType: typeof onChange };
  })()`, 90_000)
  if (!populated?.count) throw new Error(`Could not populate the file input: ${selector} (${JSON.stringify(populated)})`)
  console.log(`Selected local files via studio handler: ${JSON.stringify(populated)}`)
}

async function setInput(selector, value, tag = 'input') {
  const expression = `(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return false;
    const proto = ${tag === 'select' ? 'HTMLSelectElement' : tag === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(String(value))});
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
  const found = await evaluate(expression)
  if (!found) throw new Error(`Input not found: ${selector}`)
  await delay(80)
}

async function setCheckbox(selector, checked) {
  const found = await evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(e, ${Boolean(checked)});
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
  if (!found) throw new Error(`Checkbox not found: ${selector}`)
  await delay(80)
}

async function clickButton(selector, text = null) {
  const found = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = ${text === null
      ? 'nodes[0]'
      : `nodes.find((item) => (item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}))`};
    if (!node || node.disabled) return false;
    node.click(); return true;
  })()`)
  if (!found) throw new Error(`Could not click ${selector}${text ? ` (${text})` : ''}.`)
  await delay(80)
}

async function setVariationCount(count) {
  await setInput('input[type="number"][min="1"][max="100"]', count)
  const actual = Number(await evaluate('document.querySelector(".vb-process-config input[type=number]")?.value'))
  if (actual !== count) throw new Error(`Variation control stored ${actual}, expected ${count}.`)
}

async function clearFinished() {
  await navigateTab('downloads')
  const enabled = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Clear finished')); return Boolean(b && !b.disabled); })()`)
  if (enabled) await clickButton('button', 'Clear finished')
  await delay(150)
}

function extractJobRows(expected) {
  return `(() => [...document.querySelectorAll('.vb-job-row')].slice(0, ${expected}).map((row) => {
    const fiberKey = Object.getOwnPropertyNames(row).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? row[fiberKey] : null;
    let job = null;
    while (fiber) {
      const candidate = fiber.memoizedProps?.job;
      if (candidate && typeof candidate.variationIndex === 'number') { job = candidate; break; }
      fiber = fiber.return;
    }
    const small = [...row.querySelectorAll('.vb-job-copy small')].map((node) => node.textContent?.trim()).filter(Boolean);
    const displayName = row.querySelector('.vb-job-copy strong')?.textContent?.trim() ?? '';
    const outputName = row.dataset.status === 'completed' || row.dataset.status === 'fallback'
      ? displayName
      : job?.outputName ?? null;
    const sizeMatch = small[0]?.match(/([\d.]+)\s*(B|KB|MB|GB)\s*·/i);
    const unitScale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
    const sizeBytes = sizeMatch ? Math.round(Number(sizeMatch[1]) * unitScale[sizeMatch[2].toUpperCase()]) : null;
    const renderMatch = small[0]?.match(/(\d+)s render/i);
    const mimeLabel = small[0]?.split('·')[1]?.trim().split(';')[0].toUpperCase();
    const mimeByLabel = { WEBM: 'video/webm', MP4: 'video/mp4', MKV: 'video/x-matroska', MOV: 'video/quicktime', WEBP: 'image/webp', JPG: 'image/jpeg', JPEG: 'image/jpeg', PNG: 'image/png', GIF: 'image/gif', MP3: 'audio/mpeg', M4A: 'audio/mp4', WAV: 'audio/wav' };
    return {
      status: row.dataset.status,
      sourceName: job?.sourceName ?? displayName.replace(/_v\d{3}_[a-z0-9]+_[a-z0-9]+\.[^.]+$/i, ''),
      outputName,
      variationIndex: job?.variationIndex ?? Number(outputName?.match(/_v(\d{3})_/)?.[1] ?? 0) - 1,
      outputBytes: job?.outputBytes ?? sizeBytes,
      outputMime: job?.outputMime ?? mimeByLabel[mimeLabel] ?? null,
      outputWidth: job?.outputWidth ?? null,
      outputHeight: job?.outputHeight ?? null,
      outputDuration: job?.outputDuration ?? null,
      elapsedMs: job?.elapsedMs ?? (renderMatch ? Number(renderMatch[1]) * 1000 : null),
      error: job?.error ?? null,
      warnings: [...new Set([...(job?.warnings ?? []), ...small.slice(1)])],
      display: small,
    };
  }))()`
}

async function batch(name, count, expectedJobs, timeoutMs = 3_600_000) {
  await navigateTab('downloads')
  await setVariationCount(count)
  const maxConcurrentRenders = await evaluate('document.querySelector(".vb-process-stat strong")?.textContent?.trim() ?? null')
  const startedAt = Date.now()
  await clickButton('.vb-process-actions button', 'Generate variations')
  const terminal = new Set(['completed', 'fallback', 'failed', 'cancelled'])
  let jobs = []
  while (Date.now() - startedAt < timeoutMs) {
    jobs = await evaluate(extractJobRows(expectedJobs))
    for (const job of jobs) {
      if (!job.outputName) continue
      const source = Object.values(report.inputs).find((input) => job.outputName.startsWith(input.fileName.replace(/\.[^.]+$/, '')))
      if (source) job.sourceName = source.fileName
    }
    if (jobs.length === expectedJobs && jobs.every((job) => terminal.has(job.status))) break
    await delay(250)
  }
  const wallMs = Date.now() - startedAt
  const finished = jobs.length === expectedJobs && jobs.every((job) => terminal.has(job.status))
  const timedJobs = jobs.filter((job) => Number.isFinite(job.elapsedMs))
  const performance = await cdpCommand('Performance.getMetrics').catch(() => ({ metrics: [] }))
  const metrics = Object.fromEntries((performance.metrics ?? []).map((item) => [item.name, item.value]))
  const result = {
    name, requestedVariations: count, expectedJobs, observedJobs: jobs.length, wallMs, maxConcurrentRenders,
    completedCount: jobs.filter((job) => job.status === 'completed').length,
    fallbackCount: jobs.filter((job) => job.status === 'fallback').length,
    failedCount: jobs.filter((job) => job.status === 'failed').length,
    cancelledCount: jobs.filter((job) => job.status === 'cancelled').length,
    meanJobMs: timedJobs.length
      ? Math.round(timedJobs.reduce((sum, job) => sum + job.elapsedMs, 0) / timedJobs.length)
      : jobs.length ? Math.round(wallMs / jobs.length) : null,
    jobs, browserMetrics: metrics, finished,
  }
  report.batches.push(result)
  check(`${name}: all ${expectedJobs} outputs reached a terminal state`, finished && result.failedCount === 0 && result.cancelledCount === 0, {
    wallMs, clean: result.completedCount, fallback: result.fallbackCount, failed: result.failedCount, cancelled: result.cancelledCount,
  })
  if (!finished) throw new Error(`${name} did not reach terminal status for ${expectedJobs} jobs within ${formatMs(timeoutMs)}.`)
  return result
}

async function setDownloadFolder(folderName) {
  const folder = path.join(OUTPUT_DIR, 'exports', folderName)
  await mkdir(folder, { recursive: true })
  await cdpCommand('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: folder })
  return folder
}

async function downloadRows(batchResult, folderName, maxFiles = 200) {
  const successful = batchResult.jobs.filter((job) => (job.status === 'completed' || job.status === 'fallback') && job.outputName)
  if (!successful.length) return { folder: folderName, requested: 0, downloaded: 0, files: [], limited: false }
  let selected = successful
  let limited = false
  const expectedBytes = successful.reduce((sum, job) => sum + (job.outputBytes ?? 0), 0)
  if (successful.length > maxFiles || expectedBytes > 1_000_000_000) {
    selected = [...successful.slice(0, 2), ...successful.slice(-2)].filter((job, index, all) => all.findIndex((candidate) => candidate.outputName === job.outputName) === index)
    limited = true
  }
  const downloadDir = await setDownloadFolder(folderName)
  const names = selected.map((job) => job.outputName)
  const downloaded = []
  const missing = []
  for (const name of names) {
    let saved = false
    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      const clicked = await evaluate(`(() => {
        const row = [...document.querySelectorAll('.vb-job-row[data-status="completed"], .vb-job-row[data-status="fallback"]')].find((item) => item.querySelector('.vb-job-copy strong')?.textContent?.trim() === ${JSON.stringify(name)});
        const button = row?.querySelector('button.vb-job-action');
        if (!button) return false;
        button.click(); return true;
      })()`)
      if (!clicked) { await delay(150); continue }
      const fileStarted = Date.now()
      while (Date.now() - fileStarted < 3_000) {
        const files = await readdir(downloadDir).catch(() => [])
        if (files.includes(name)) { saved = true; break }
        await delay(80)
      }
    }
    if (saved) downloaded.push(name)
    else missing.push(name)
    if (names.length > 20) await delay(80)
  }
  const result = {
    folder: path.relative(OUTPUT_DIR, downloadDir), requested: selected.length,
    downloaded: downloaded.length, files: downloaded, missing, limited,
  }
  if (downloaded.length !== selected.length) {
    report.notes.push(`Download check for ${folderName}: ${downloaded.length}/${selected.length} local exports arrived; no media was uploaded by this download path.`)
  }
  return result
}

async function selectConverterTarget(target) {
  await navigateTab('converter')
  const label = TARGET_LABELS[target]
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.vb-format-chip')].find((item) => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click(); return true;
  })()`)
  if (!clicked) throw new Error(`Converter target ${target} is not available in the studio UI.`)
  await delay(100)
  const selected = await evaluate(`(() => [...document.querySelectorAll('.vb-format-chip')].some((item) => item.hasAttribute('data-on') && item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(label)}))()`)
  if (!selected) throw new Error(`Converter target ${target} did not become selected.`)
  await navigateTab('compressor')
  await clickButton('.vb-preset-chip', QUALITY_BY_TARGET[target])
  await setInput('input[type="range"]', target === 'mp4' ? 78 : target === 'webm' ? 58 : target === 'png' || target === 'wav' || target === 'keep' ? 100 : 74)
  await navigateTab('converter')
  const persisted = await evaluate(`(() => [...document.querySelectorAll('.vb-format-chip')].some((item) => item.hasAttribute('data-on') && item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(label)}))()`)
  if (!persisted) throw new Error(`Converter target ${target} did not persist across workspace navigation.`)
}

async function setEffectsForFastVideo() {
  await navigateTab('effects')
  const enabled = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.vb-range-row')].find((item) => item.querySelector('.vb-range-title strong')?.textContent?.trim() === 'Playback speed');
    if (!row) return false;
    const toggle = row.querySelector('input[type=checkbox]');
    if (!toggle.checked) toggle.click();
    return true;
  })()`)
  if (!enabled) throw new Error('Playback speed range was not found.')
  await delay(150)
  await setInput('input[aria-label="Playback speed minimum"]', '4')
  await setInput('input[aria-label="Playback speed maximum"]', '4')
  const speedState = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.vb-range-row')].find((item) => item.querySelector('.vb-range-title strong')?.textContent?.trim() === 'Playback speed');
    return { enabled: row?.querySelector('input[type=checkbox]')?.checked, min: row?.querySelector('[aria-label="Playback speed minimum"]')?.value, max: row?.querySelector('[aria-label="Playback speed maximum"]')?.value };
  })()`)
  check('Video stress playback speed set to 4×', speedState.enabled && speedState.min === '4' && speedState.max === '4', speedState)
  await navigateTab('compressor')
  await setSelect('#vb-resolution', '720p')
  const bitrateSet = await evaluate(`(() => {
    const label = [...document.querySelectorAll('.vb-form-field')].find((item) => item.textContent.includes('Video bitrate'));
    const input = label?.querySelector('input[type=range]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1');
    input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  })()`)
  if (!bitrateSet) throw new Error('Video bitrate control was not found.')
  const exportState = await evaluate(`(() => {
    const label = [...document.querySelectorAll('.vb-form-field')].find((item) => item.textContent.includes('Video bitrate'));
    return { resolution: document.querySelector('#vb-resolution')?.value, bitrateMbps: label?.querySelector('input[type=range]')?.value };
  })()`)
  check('Video stress resolution and bitrate controls apply', exportState.resolution === '720p' && exportState.bitrateMbps === '1', exportState)
}

async function setSelect(selector, value) {
  await setInput(selector, value, 'select')
}

async function assertFileRows(expected, timeoutMs = 25_000) {
  return waitForPage(`document.querySelectorAll('.vb-file-row').length === ${expected}`, timeoutMs, `Expected ${expected} source file rows.`)
}

async function clearSources() {
  const hasFiles = await evaluate('document.querySelectorAll(".vb-file-row").length > 0')
  if (hasFiles) {
    const cleared = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Clear files'); if (!b) return false; b.click(); return true; })()`)
    if (!cleared) throw new Error('Could not clear source media.')
    await assertFileRows(0)
  }
}

async function loadSources(files) {
  await navigateTab('effects')
  await setFiles('input[accept="video/*,image/*"]', files)
  await assertFileRows(files.length)
  const state = await evaluate(`(() => [...document.querySelectorAll('.vb-file-row')].map((row) => ({
    name: row.querySelector('.vb-file-copy strong')?.textContent?.trim(),
    meta: row.querySelector('.vb-file-copy small')?.textContent?.trim(),
    status: row.querySelector('.vb-file-state')?.textContent?.trim(),
    error: row.querySelector('.vb-error-text')?.textContent?.trim() ?? null,
  })))()`)
  return state
}

async function clickRemoveSource(fileName) {
  const found = await evaluate(`(() => { const row = [...document.querySelectorAll('.vb-file-row')].find((item) => item.querySelector('.vb-file-copy strong')?.textContent?.trim() === ${JSON.stringify(fileName)}); const button = row?.querySelector('button[aria-label^="Remove "]'); if (!button) return false; button.click(); return true; })()`)
  if (!found) throw new Error(`Could not remove source ${fileName}.`)
  await delay(200)
}

async function clickSelectSource(fileName) {
  const found = await evaluate(`(() => { const button = [...document.querySelectorAll('.vb-file-select')].find((item) => item.textContent.includes(${JSON.stringify(fileName)})); if (!button) return false; button.click(); return true; })()`)
  if (!found) throw new Error(`Could not select source ${fileName}.`)
  await delay(100)
}

async function setRange(label, min, max, enabled = true) {
  const found = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.vb-range-row')].find((item) => item.querySelector('.vb-range-title strong')?.textContent?.trim() === ${JSON.stringify(label)});
    if (!row) return false;
    const checkbox = row.querySelector('input[type=checkbox]');
    if (checkbox.checked !== ${Boolean(enabled)}) { checkbox.checked = ${Boolean(enabled)}; checkbox.dispatchEvent(new Event('input', { bubbles:true })); checkbox.dispatchEvent(new Event('change', { bubbles:true })); }
    for (const [suffix, value] of [['minimum', ${JSON.stringify(String(min))}], ['maximum', ${JSON.stringify(String(max))}]]) {
      const input = row.querySelector('input[aria-label="' + ${JSON.stringify(label)} + ' ' + suffix + '"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));
    }
    return true;
  })()`)
  if (!found) throw new Error(`Effect control not found: ${label}`)
}

async function setNamedCheckbox(containerSelector, label, checked) {
  const found = await evaluate(`(() => {
    const container = [...document.querySelectorAll(${JSON.stringify(containerSelector)})].find((item) => item.textContent.includes(${JSON.stringify(label)}));
    const input = container?.querySelector('input[type=checkbox]');
    if (!input) return false;
    if (input.checked !== ${Boolean(checked)}) { input.checked = ${Boolean(checked)}; input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true })); }
    return true;
  })()`)
  if (!found) throw new Error(`Checkbox not found in ${containerSelector}: ${label}`)
}

async function inspectDetails() {
  const videoInfo = await evaluate(`(() => { const video = document.querySelector('.vb-preview-frame video'); return video ? { width: video.videoWidth, height: video.videoHeight, duration: video.duration, readyState: video.readyState, error: video.error?.message ?? null } : null; })()`)
  const imageInfo = await evaluate(`(() => { const image = document.querySelector('.vb-preview-frame img'); return image ? { width: image.naturalWidth, height: image.naturalHeight, complete: image.complete } : null; })()`)
  return { videoInfo, imageInfo }
}

async function exerciseInputBoundaries() {
  await navigateTab('effects')
  const countSelector = 'input[type="number"][min="1"][max="100"]'
  await setInput(countSelector, '0')
  const lowerBound = Number(await evaluate('document.querySelector(".vb-process-config input[type=number]")?.value'))
  await setInput(countSelector, '101')
  const upperBound = Number(await evaluate('document.querySelector(".vb-process-config input[type=number]")?.value'))
  await setInput(countSelector, '1')
  check('Variation count clamps to 1–100', lowerBound === 1 && upperBound === 100, { lowerBound, upperBound })

  const seedBefore = await evaluate('document.querySelector(".vb-seed-line code")?.textContent?.trim()')
  await clickButton('button[aria-label="Randomize batch seed"]')
  const seedAfter = await evaluate('document.querySelector(".vb-seed-line code")?.textContent?.trim()')
  check('Batch seed randomization control', Boolean(seedBefore && seedAfter && seedBefore !== seedAfter), { before: seedBefore, after: seedAfter })

  await setInput('input[aria-label="Brightness minimum"]', '5')
  await setInput('input[aria-label="Brightness maximum"]', '2')
  const rangeError = await evaluate('document.querySelector(".vb-bottom-error[role=alert]")?.textContent?.trim() ?? null')
  const generateDisabled = await evaluate('[...document.querySelectorAll(".vb-process-actions button")].some((button) => button.textContent.includes("Generate variations") && button.disabled)')
  await setInput('input[aria-label="Brightness minimum"]', '-3')
  await setInput('input[aria-label="Brightness maximum"]', '3')
  check('Invalid effect ranges are blocked before rendering', Boolean(rangeError?.includes('minimum must not exceed maximum')) && generateDisabled, { message: rangeError, generateDisabled })
}

async function downloadPresetExport() {
  const folder = await setDownloadFolder('preset-flows')
  await clickButton('.vb-preset-actions button', 'Export')
  const expected = 'video-batcher-preset.json'
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    const files = await readdir(folder).catch(() => [])
    if (files.includes(expected)) return path.join(folder, expected)
    await delay(150)
  }
  throw new Error('Export preset download did not arrive.')
}

async function runPresetFlows() {
  await navigateTab('effects')
  await evaluate(`(() => {
    window.prompt = (_message, defaultValue) => defaultValue ? 'Benchmark renamed' : 'Benchmark preset';
    window.confirm = () => true;
    const save = [...document.querySelectorAll('.vb-preset-actions button')].find((button) => button.textContent.trim() === 'Save');
    save?.click();
  })()`)
  const saved = await waitForPage('document.querySelector(".vb-presets [role=status]")?.textContent?.includes("Saved")', 5_000, 'Save preset flow did not confirm.')
  check('Preset save', Boolean(saved))
  const savedPreset = await evaluate(`localStorage.getItem('social-transcriber.video-batcher.presets.v1')`)
  assert.ok(savedPreset?.includes('Benchmark preset'))

  const builtInResults = []
  for (const [name, verify] of [
    ['Light color variation', `(() => { const row = [...document.querySelectorAll('.vb-range-row')].find((item) => item.querySelector('.vb-range-title strong')?.textContent?.trim() === 'Brightness'); return row?.querySelector('input[type=checkbox]')?.checked && row.querySelector('[aria-label="Brightness minimum"]')?.value === '-3'; })()`],
    ['Subtle motion', `(() => { const row = [...document.querySelectorAll('.vb-range-row')].find((item) => item.querySelector('.vb-range-title strong')?.textContent?.trim() === 'Zoom'); return row?.querySelector('input[type=checkbox]')?.checked && row.querySelector('[aria-label="Zoom minimum"]')?.value === '1.02'; })()`],
    ['Social video export', null],
  ]) {
    if (name === 'Social video export') await navigateTab('converter')
    else await navigateTab('effects')
    const selection = await evaluate(`(() => { const select = document.querySelector('.vb-preset-select'); const option = [...(select?.options ?? [])].find((item) => item.textContent.trim() === ${JSON.stringify(name)}); if (!option) return false; select.value = option.value; select.dispatchEvent(new Event('change', { bubbles:true })); return true; })()`)
    await delay(120)
    let matched
    if (name === 'Social video export') {
      const aspectIsPortrait = await evaluate('document.querySelector("#vb-aspect")?.value === "portrait"')
      await navigateTab('compressor')
      const resolutionIs1080p = await evaluate('document.querySelector("#vb-resolution")?.value === "1080p"')
      matched = selection && Boolean(aspectIsPortrait) && Boolean(resolutionIs1080p)
    } else {
      matched = selection && Boolean(await evaluate(verify))
    }
    builtInResults.push({ name, passed: matched })
    check(`Built-in preset ${name}`, matched)
  }

  await navigateTab('effects')
  await clickButton('button[aria-label^="Duplicate Benchmark preset"]')
  await clickButton('button[aria-label^="Rename Benchmark preset copy"]')
  await clickButton('button[aria-label^="Delete Benchmark renamed"]')
  const exportPath = await downloadPresetExport()
  await setFiles('input[accept="application/json,.json"]', [exportPath])
  const imported = await waitForPage('document.querySelector(".vb-presets [role=status]")?.textContent?.includes("Loaded")', 5_000, 'Import preset flow did not confirm.')
  check('Preset duplicate / rename / delete / export / import', Boolean(imported), { exportDownloaded: existsSync(exportPath) })

  const preset = JSON.parse(await readFile(exportPath, 'utf8'))
  const invalidPresetPath = path.join(OUTPUT_DIR, 'fixtures', 'invalid-video-batcher-preset.json')
  await writeFile(invalidPresetPath, '{"schemaVersion":999,"name":"bad"}\n', 'utf8')
  await setFiles('input[accept="application/json,.json"]', [invalidPresetPath])
  const invalidMessage = await waitForPage('document.querySelector(".vb-presets [role=status]")?.textContent?.includes("supported")', 5_000, 'Invalid preset was not rejected visibly.')
  check('Invalid preset is rejected', Boolean(invalidMessage))
  return { exportedSchemaVersion: preset.schemaVersion, invalidImportRejected: Boolean(invalidMessage), builtInResults }
}

async function exerciseRetry(videoOnly) {
  await clearFinished()
  await navigateTab('downloads')
  await setVariationCount(1)
  await evaluate(`(() => {
    const Native = window.MediaRecorder;
    window.__benchmarkNativeMediaRecorder = Native;
    class InjectedFailure extends Native {
      constructor() { throw new Error('Benchmark-injected constructor failure for Retry control.'); }
      static isTypeSupported(mime) { return Native.isTypeSupported(mime); }
    }
    window.MediaRecorder = InjectedFailure;
  })()`)
  await clickButton('.vb-process-actions button', 'Generate variations')
  const failed = await waitForPage('Boolean(document.querySelector(".vb-job-row[data-status=failed]"))', 15_000, 'Injected render failure did not reach the failed state.')
  await evaluate('window.MediaRecorder = window.__benchmarkNativeMediaRecorder')
  check('Failed job state is recoverable', Boolean(failed), { onlyVideo: videoOnly })
  await clickButton('.vb-job-row[data-status="failed"] button', 'Retry')
  const retried = await waitForPage('Boolean(document.querySelector(".vb-job-row[data-status=completed]"))', 90_000, 'Retry did not complete after restoring MediaRecorder.')
  const retryRows = await evaluate(extractJobRows(1))
  const result = { failedStateShown: Boolean(failed), retryCompleted: Boolean(retried), job: retryRows[0] }
  check('Retry succeeds after renderer recovery', Boolean(retried) && retryRows[0]?.status === 'completed', retryRows[0]?.elapsedMs)
  return result
}

async function exercisePauseResumeCancel() {
  await clearFinished()
  await navigateTab('downloads')
  await setVariationCount(100)
  await clickButton('.vb-process-actions button', 'Generate variations')
  await waitForPage('Boolean(document.querySelector(".vb-job-row[data-status=processing]"))', 20_000, 'Batch did not start for pause/cancel test.')
  await clickButton('.vb-process-actions button', 'Pause')
  const paused = await waitForPage('document.querySelector(".vb-process-actions button")?.textContent?.includes("Resume")', 5_000, 'Pause did not change the control to Resume.')
  await delay(250)
  await clickButton('.vb-process-actions button', 'Resume')
  const resumed = await waitForPage('document.querySelector(".vb-process-actions button")?.textContent?.includes("Pause")', 5_000, 'Resume did not restore the Pause control.')
  await clickButton('.vb-process-actions button', 'Cancel')
  const started = Date.now()
  let jobs = []
  while (Date.now() - started < 30_000) {
    jobs = await evaluate(extractJobRows(100))
    if (jobs.length === 100 && jobs.every((job) => ['completed', 'fallback', 'failed', 'cancelled'].includes(job.status))) break
    await delay(100)
  }
  const cancelled = jobs.filter((job) => job.status === 'cancelled').length
  const result = { paused: Boolean(paused), resumed: Boolean(resumed), jobs: jobs.length, cancelled, completed: jobs.filter((job) => job.status === 'completed').length }
  check('Pause / resume / cancel controls', Boolean(paused) && Boolean(resumed) && jobs.length === 100 && cancelled > 0, result)
  return result
}

async function setImageFeatureSettings() {
  await navigateTab('effects')
  await setRange('Brightness', 6, 6, true)
  await setRange('Contrast', 8, 8, true)
  await setRange('Saturation', 10, 10, true)
  await setRange('Hue', 8, 8, true)
  await setRange('Zoom', 1.05, 1.05, true)
  await setRange('Rotation', 1, 1, true)
  await setRange('Horizontal shift', 1, 1, true)
  await setRange('Vertical shift', -1, -1, true)
  await setRange('Playback speed', 1, 1, true)
  await setRange('Trim from start', 0, 0, true)
  await setRange('Trim from end', 0, 0, true)
  await setNamedCheckbox('.vb-check-row', 'Flip horizontal', true)
  await setNamedCheckbox('.vb-check-row', 'Flip vertical', true)

  await navigateTab('captions')
  await setInput('#vb-caption-list', 'LOCAL TEST — caption alpha\nLOCAL TEST — caption beta', 'textarea')
  const captionControls = await evaluate(`(() => {
    const field = [...document.querySelectorAll('.vb-form-field')].find((item) => item.textContent.includes('Font size'));
    if (!field) return false;
    const input = field.querySelector('input[type=number]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '42');
    input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));
    document.querySelector('input.vb-color-input')?.setAttribute('value', '#f4d35e');
    return true;
  })()`)
  if (!captionControls) throw new Error('Caption size controls were not found.')
  await setInput('input.vb-color-input', '#f4d35e')

  await navigateTab('watermark')
  await setInput('#vb-watermark-text', 'SOCIAL TRANSCRIBER QA')
  await setInput('input[type="range"]', '72')

  await navigateTab('metadata')
  for (const label of ['Variation Tag', 'Creation Time', 'File Comments', 'Title', 'Encoder Parameters', 'Encoder Tag', 'GPS Data', 'Source Tags', 'Clean Export']) {
    await setNamedCheckbox('.vb-meta-card', label, true)
  }
  await setInput('input[aria-label="Encoder tag value"]', 'Studio benchmark')

  await navigateTab('converter')
  await selectConverterTarget('webp')
}

async function setVideoFeatureSettings() {
  await navigateTab('effects')
  await setRange('Brightness', 4, 4, true)
  await setRange('Contrast', 2, 2, true)
  await setRange('Saturation', 5, 5, true)
  await setRange('Hue', 5, 5, true)
  await setRange('Zoom', 1.02, 1.02, true)
  await setRange('Rotation', 0.5, 0.5, true)
  await setRange('Horizontal shift', 0.5, 0.5, true)
  await setRange('Vertical shift', -0.5, -0.5, true)
  await setRange('Playback speed', 1, 1, true)
  await setRange('Trim from start', 0.1, 0.1, true)
  await setRange('Trim from end', 0.1, 0.1, true)
  await setNamedCheckbox('.vb-check-row', 'Flip horizontal', true)
  await setNamedCheckbox('.vb-check-row', 'Flip vertical', false)

  await navigateTab('captions')
  await setInput('#vb-caption-list', 'LOCAL VIDEO CAPTION\nSECOND CAPTION OPTION', 'textarea')
  await navigateTab('audio')
  const audioValues = { Volume: 3, 'Low · 120 Hz': -2, 'Mid · 1 kHz': 2, 'High · 8 kHz': 3 }
  for (const [label, value] of Object.entries(audioValues)) {
    const set = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.vb-audio-range')].find((item) => item.textContent.includes(${JSON.stringify(label)}));
      const input = row?.querySelector('input[type=range]');
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    })()`)
    if (!set) throw new Error(`Audio setting not found: ${label}`)
  }
  for (const [label, value] of [['Fade in', 0.2], ['Fade out', 0.2]]) {
    const set = await evaluate(`(() => {
      const field = [...document.querySelectorAll('.vb-form-field')].find((item) => item.textContent.includes(${JSON.stringify(label)}));
      const input = field?.querySelector('input[type=number]');
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));
      return input.value === ${JSON.stringify(String(value))};
    })()`)
    if (!set) throw new Error(`Audio ${label} control could not be set.`)
  }

  await navigateTab('metadata')
  for (const label of ['Variation Tag', 'Creation Time', 'File Comments', 'Title', 'Encoder Parameters', 'Encoder Tag', 'GPS Data', 'Source Tags', 'Clean Export']) {
    await setNamedCheckbox('.vb-meta-card', label, true)
  }
  await setInput('input[aria-label="Encoder tag value"]', 'Studio benchmark')

  await navigateTab('watermark')
  await setInput('#vb-watermark-text', '')
  await setFiles('input[accept="image/*"]', [IMAGE_PATH])
  await delay(120)
  await navigateTab('converter')
  await selectConverterTarget('mp4')
  await navigateTab('compressor')
  await setSelect('#vb-resolution', '720p')
  const bitrateSet = await evaluate(`(() => {
    const label = [...document.querySelectorAll('.vb-form-field')].find((item) => item.textContent.includes('Video bitrate'));
    const input = label?.querySelector('input[type=range]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2');
    input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  })()`)
  if (!bitrateSet) throw new Error('Could not set the video bitrate for the integrated video feature run.')
  await clickButton('.vb-preset-chip', 'Balanced')
}

async function runConverterMatrix(mediaKind, sourceFile, outputPrefix) {
  const entries = []
  await clearSources()
  await loadSources([sourceFile])
  if (mediaKind === 'video') await setEffectsForFastVideo()
  else await navigateTab('effects')

  for (const target of CONVERTER_TARGETS) {
    if (mediaKind === 'video') await selectConverterTarget(target)
    else await selectConverterTarget(target)
    const result = await batch(`${outputPrefix}-${target}`, 1, 1, 180_000)
    const job = result.jobs[0]
    const expectedMismatch = mediaKind === 'image' && ['mp4', 'webm', 'mkv', 'mov', 'mp3', 'm4a', 'wav'].includes(target)
    const conversionWarnings = (job.warnings ?? []).filter((warning) => /converter could not start|conversion did not finish|metadata pass did not finish/i.test(warning))
    const downloaded = await downloadRows(result, `${outputPrefix}-${target}`, 3)
    const expectedMime = ({
      mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', gif: 'image/gif',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    })[target] ?? job.outputMime
    const outputExtension = job.outputName?.split('.').pop()?.toLowerCase()
    const expectedFallback = mediaKind === 'image' && expectedMismatch
    const actualTarget = target === 'keep'
      ? job.status === 'completed'
      : expectedFallback
        ? job.status === 'fallback' && (job.warnings ?? []).some((warning) => /needs a video source/i.test(warning))
        : job.status === 'completed' && job.outputMime?.split(';')[0] === expectedMime && outputExtension === target
    const entry = {
      mediaKind, target, status: job.status, outputMime: job.outputMime, expectedMime, outputName: job.outputName, elapsedMs: job.elapsedMs,
      outputBytes: job.outputBytes, warnings: job.warnings ?? [], warningCount: (job.warnings ?? []).length,
      expectedMismatch, conversionWarnings, downloaded: downloaded.downloaded === 1, downloadInfo: downloaded,
    }
    entries.push(entry)
    report.converterMatrix.push(entry)
    check(`${outputPrefix} converter target ${target}`, actualTarget && (expectedFallback || conversionWarnings.length === 0), {
      status: job.status, mime: job.outputMime, expectedMime, output: job.outputName, warningCount: entry.warningCount, conversionWarnings,
    })
    await clearFinished()
  }
  return entries
}

let cdpTarget = null
try {
  assert.ok(existsSync(CHROME_PATH), `Chrome was not found at ${CHROME_PATH}. Set CHROME_BIN to your browser executable.`)
  assert.ok(process.env.SESSION_SECRET, 'SESSION_SECRET was not loaded. Run with node --env-file=.env.local.')
  report.inputs.video = await hashInput(VIDEO_PATH)
  report.inputs.image = await hashInput(IMAGE_PATH)

  if (process.env.BENCHMARK_SKIP_UNIT !== '1') {
    const unit = await runUnitSuite()
    report.unitTests = unit
    check('Project unit suite', unit.exitCode === 0 && unit.failed === 0, { passed: unit.passed, failed: unit.failed, durationMs: unit.durationMs })
  }

  const unauthenticated = await fetch(`${BASE_URL}/video-batcher/effects`, { redirect: 'manual' })
  const unauthenticatedBody = await unauthenticated.text()
  check('Local studio endpoint responds before authentication', unauthenticated.status === 200 && unauthenticatedBody.includes('Sign in'), { status: unauthenticated.status })

  chrome = spawn(CHROME_PATH, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1680,1200',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(OUTPUT_DIR, 'chrome-profile')}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  const cdpStarted = Date.now()
  let cdpVersion = null
  while (Date.now() - cdpStarted < 30_000) {
    try {
      const response = await fetch(`${CDP_HTTP}/json/version`)
      if (response.ok) { cdpVersion = await response.json(); break }
    } catch { /* Chrome is still starting. */ }
    await delay(250)
  }
  assert.ok(cdpVersion, `Chrome DevTools did not start on port ${cdpPort}.`)
  report.environment.browser = cdpVersion.Browser

  const targetResponse = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  assert.ok(targetResponse.ok, `Could not create a Chrome page target (${targetResponse.status}).`)
  cdpTarget = await targetResponse.json()
  targetId = cdpTarget.id
  await connectSocket(cdpTarget.webSocketDebuggerUrl)
  await Promise.all([
    cdpCommand('Network.enable'), cdpCommand('Page.enable'), cdpCommand('Runtime.enable'),
    cdpCommand('DOM.enable'), cdpCommand('Performance.enable'), cdpCommand('Log.enable'),
    cdpCommand('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1200, deviceScaleFactor: 1, mobile: false }),
  ])
  await cdpCommand('Network.setCookie', {
    name: 'tx_session', value: issueSessionToken(process.env.SESSION_SECRET), url: BASE_URL,
    httpOnly: true, sameSite: 'Lax', secure: false,
  })
  await cdpCommand('Page.navigate', { url: `${BASE_URL}/video-batcher/effects` })
  await waitForPage('Boolean(document.querySelector(".video-batcher"))', 30_000, 'Authenticated studio route did not load.')
  check('Authenticated Video Batcher route loads', Boolean(await evaluate('document.querySelector(".video-batcher h1")?.textContent?.includes("Video Batcher")')))

  for (const tab of TAB_IDS) {
    const route = await navigateTab(tab)
    check(`Workspace route ${tab}`, route.loaded, route.heading)
  }

  await navigateTab('effects')
  report.environment.browserHydration = await evaluate(`(() => {
    const root = document.querySelector('.video-batcher');
    const input = document.querySelector('input[accept="video/*,image/*"]');
    const internals = (node) => Object.getOwnPropertyNames(node ?? {}).filter((key) => key.startsWith('__react'));
    return {
      readyState: document.readyState,
      scripts: [...document.scripts].map((script) => script.src).filter(Boolean).map((src) => new URL(src).pathname).slice(0, 30),
      nextFlightPresent: Boolean(window.__next_f),
      rootReactKeys: internals(root),
      inputReactKeys: internals(input),
      inputAccept: input?.accept ?? null,
    };
  })()`)
  console.log('Browser hydration probe:', JSON.stringify(report.environment.browserHydration))
  // A real picker filters text files before the app sees them. The test uses a
  // synthetic selection to exercise the studio's own unsupported-file guard.
  const invalidPath = path.join(OUTPUT_DIR, 'fixtures', 'unsupported-input.txt')
  await writeFile(invalidPath, 'not a video or image file\n', 'utf8')
  await setFiles('input[accept="video/*,image/*"]', [invalidPath])
  await delay(300)
  const invalidState = await evaluate(`({
    error: document.querySelector('.vb-inline-error[role=alert]')?.textContent?.trim() ?? null,
    sourceStatus: document.querySelector('.vb-source-title span')?.textContent?.trim() ?? null,
    sourceRows: document.querySelectorAll('.vb-file-row').length,
  })`)
  check('Unsupported input validation', Boolean(invalidState.error), invalidState)
  await delay(200)

  const imported = await loadSources([VIDEO_PATH, IMAGE_PATH])
  const noInspectionErrors = imported.length === 2 && imported.every((item) => item.status === 'Ready' && !item.error)
  report.inputs.video.mediaInfo = imported.find((item) => item.name === report.inputs.video.fileName)?.meta ?? null
  report.inputs.image.mediaInfo = imported.find((item) => item.name === report.inputs.image.fileName)?.meta ?? null
  const videoDetails = await inspectDetails()
  await clickSelectSource(report.inputs.image.fileName)
  const imageDetails = await inspectDetails()
  await clickSelectSource(report.inputs.video.fileName)
  const mediaDetails = { videoInfo: videoDetails.videoInfo, imageInfo: imageDetails.imageInfo }
  report.inputs.video.browser = { ...videoDetails.videoInfo, durationFromInspection: report.inputs.video.mediaInfo?.match(/· (\d+)s/)?.[1] ? Number(report.inputs.video.mediaInfo.match(/· (\d+)s/)[1]) : null }
  report.inputs.image.browser = imageDetails.imageInfo
  check('Supplied video and image inspect successfully', noInspectionErrors, { files: imported, ...mediaDetails })
  if (!noInspectionErrors) throw new Error('At least one supplied media input could not be inspected by the browser.')
  await exerciseInputBoundaries()

  await setFiles('input[accept="video/*,image/*"]', [VIDEO_PATH, IMAGE_PATH])
  await delay(350)
  const afterDuplicateAdd = await evaluate('document.querySelectorAll(".vb-file-row").length')
  check('Duplicate file selection is deduplicated', afterDuplicateAdd === 2, { fileRows: afterDuplicateAdd })

  const baseOne = await batch('both-inputs-1-variation', 1, 2, 180_000)
  check('One-variation batch returns unique output filenames', new Set(baseOne.jobs.map((job) => job.outputName)).size === 2, baseOne.jobs.map((job) => job.outputName))
  const baselineDownloads = await downloadRows(baseOne, 'baseline-one-each')
  check('Baseline outputs download locally', baselineDownloads.downloaded === 2, baselineDownloads)
  const removableName = baseOne.jobs.find((job) => job.outputName)?.outputName
  if (removableName) {
    const removed = await evaluate(`(() => { const row = [...document.querySelectorAll('.vb-job-row')].find((item) => item.querySelector('.vb-job-copy strong')?.textContent?.trim() === ${JSON.stringify(removableName)}); const button = row?.querySelector('button[aria-label^="Remove "]'); if (!button) return false; button.click(); return true; })()`)
    await delay(120)
    const remaining = await evaluate('document.querySelectorAll(".vb-job-row").length')
    check('Completed output can be removed from Downloads', Boolean(removed) && remaining === 1, { remaining })
  }
  await clearFinished()

  await clearSources()
  await loadSources([IMAGE_PATH])
  const imageOne = await batch('image-1-default', 1, 1, 120_000)
  await downloadRows(imageOne, 'image-one-default', 2)
  await clearFinished()
  const image100 = await batch('image-100-variations', 100, 100, 900_000)
  check('Image 100-variation run has unique filenames and all indices',
    image100.completedCount === 100 && new Set(image100.jobs.map((job) => job.outputName)).size === 100 && new Set(image100.jobs.map((job) => job.variationIndex)).size === 100,
    { meanJobMs: image100.meanJobMs, wallMs: image100.wallMs, outputBytes: image100.jobs.reduce((sum, job) => sum + (job.outputBytes ?? 0), 0) })
  const image100Downloads = await downloadRows(image100, 'image-100-variations')
  check('Image stress outputs saved locally', image100Downloads.downloaded > 0, { requested: image100Downloads.requested, downloaded: image100Downloads.downloaded, folder: image100Downloads.folder, limited: image100Downloads.limited, missing: image100Downloads.missing.length })
  await clearFinished()

  await clearSources()
  await loadSources([VIDEO_PATH])
  const videoOne = await batch('video-1-default', 1, 1, 240_000)
  const videoOneJob = videoOne.jobs[0]
  await downloadRows(videoOne, 'video-one-default', 2)
  const projectedMs = (videoOneJob.elapsedMs ?? videoOne.wallMs) * 100
  const projectedBytes = (videoOneJob.outputBytes ?? 0) * 100
  const optimizedHundred = projectedMs > 900_000 || projectedBytes > 1_000_000_000
  let videoHundredReference = videoOne
  if (optimizedHundred) {
    report.notes.push(`For the 100-video run, used the studio's 4× playback setting, 720p cap and 1 Mbps bitrate: the measured single default output projected to ${formatMs(projectedMs)} / ${(projectedBytes / 1024 ** 2).toFixed(1)} MiB for 100 sequential outputs. The optimized 1-output reference is captured for apples-to-apples scaling.`)
    await setEffectsForFastVideo()
    await clearFinished()
    videoHundredReference = await batch('video-1-fast-720p-reference', 1, 1, 180_000)
    await downloadRows(videoHundredReference, 'video-one-fast-reference', 2)
  } else {
    report.notes.push(`The default 100-video run was estimated at ${formatMs(projectedMs)} from the completed single-output baseline.`)
  }

  const cancellation = await exercisePauseResumeCancel()
  await clearFinished()

  await setVideoFeatureSettings()
  const videoFeatures = await batch('video-integrated-effects-captions-audio-metadata-logo-conversion', 1, 1, 900_000)
  const featureJob = videoFeatures.jobs[0]
  check('Integrated video features render a playable output', featureJob.status === 'completed', { mime: featureJob.outputMime, warnings: featureJob.warnings })
  await downloadRows(videoFeatures, 'integrated-video-features', 2)
  await clearFinished()

  const retry = await exerciseRetry(true)
  await clearFinished()

  const videoMatrix = await runConverterMatrix('video', VIDEO_PATH, 'video-converter')
  await clearFinished()
  const imageMatrix = await runConverterMatrix('image', IMAGE_PATH, 'image-converter')
  await clearFinished()

  await clearSources()
  await loadSources([IMAGE_PATH])
  await setImageFeatureSettings()
  const imageFeatures = await batch('image-effects-captions-text-watermark-all-metadata-webp', 1, 1, 120_000)
  check('Integrated image effects/caption/text-watermark/metadata/render', imageFeatures.jobs[0]?.status === 'completed', imageFeatures.jobs[0])
  await downloadRows(imageFeatures, 'integrated-image-features', 2)
  await clearFinished()

  const presets = await runPresetFlows()

  // Leave the longest stress run until the end: clearing 100 large browser
  // blobs can trigger a long garbage-collection pause before later UI checks.
  await clearSources()
  await loadSources([VIDEO_PATH])
  await setEffectsForFastVideo()
  const video100 = await batch(optimizedHundred ? 'video-100-fast-720p' : 'video-100-default', 100, 100,
    Math.max(900_000, Math.min(3_600_000, (videoHundredReference.jobs[0]?.elapsedMs ?? 15_000) * 145 + 180_000)))
  video100.optimizedConfiguration = optimizedHundred ? { speed: '4×', resolution: '720p', bitrateMbps: 1 } : { speed: 'source/default', resolution: '1080p cap', bitrateMbps: 6 }
  check('Video 100-variation run has unique names and all indices',
    video100.completedCount === 100 && new Set(video100.jobs.map((job) => job.outputName)).size === 100 && new Set(video100.jobs.map((job) => job.variationIndex)).size === 100,
    { meanJobMs: video100.meanJobMs, wallMs: video100.wallMs, config: video100.optimizedConfiguration })
  const video100Downloads = await downloadRows(video100, optimizedHundred ? 'video-100-fast-720p' : 'video-100-default')
  check('Video stress outputs saved locally', video100Downloads.downloaded > 0, { requested: video100Downloads.requested, downloaded: video100Downloads.downloaded, folder: video100Downloads.folder, limited: video100Downloads.limited, missing: video100Downloads.missing.length })
  await clearFinished()

  report.network.origins = [...seenOrigins].sort()
  report.notes.push(`100-image timings: ${image100.jobs.length} verified jobs; mean ${formatMs(image100.meanJobMs)}, wall ${formatMs(image100.wallMs)}.`)
  report.notes.push(`100-video timings: ${video100.jobs.length} verified jobs; mean ${formatMs(video100.meanJobMs)}, wall ${formatMs(video100.wallMs)}; optimization=${optimizedHundred}.`)
  report.notes.push(`Stress output files written locally: ${image100Downloads.downloaded}/${image100Downloads.requested} stills and ${video100Downloads.downloaded}/${video100Downloads.requested} videos. Every generated job record is in results.json and batches.csv.`)
  report.notes.push(`Converter matrix rows: ${videoMatrix.length} video targets and ${imageMatrix.length} image targets.`)
  report.notes.push(`Workflow stress controls: ${JSON.stringify(cancellation)}; retry path: ${JSON.stringify({ failedStateShown: retry.failedStateShown, retryCompleted: retry.retryCompleted })}; preset flows: ${JSON.stringify(presets)}.`)
  check('Browser JavaScript has no unhandled errors', report.browserErrors.length === 0, report.browserErrors.slice(0, 5))
  check('No failed browser network requests', report.network.failedRequests.length === 0, report.network.failedRequests.slice(0, 5))
} catch (error) {
  report.fatalError = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('FATAL:', error)
} finally {
  report.network.origins = [...seenOrigins].sort()
  if (socket && socket.readyState === WebSocket.OPEN) socket.close()
  if (targetId) await fetch(`${CDP_HTTP}/json/close/${targetId}`).catch(() => undefined)
  if (chrome && !chrome.killed) {
    chrome.kill()
    await delay(300)
  }
  await saveReports()
  console.log(`\nBenchmark artifacts: ${OUTPUT_DIR}`)
}

const failedChecks = report.checks.filter((item) => !item.passed)
if (report.fatalError || failedChecks.length || report.unitTests?.exitCode !== 0) process.exitCode = 1
