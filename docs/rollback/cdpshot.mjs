/* Screenshot via CDP. Layout width and capture width are the same number here,
 * which the bare --window-size flag does not guarantee. Sets the console
 * session cookie so gated pages can be seen. */
const [, , url, out, themeArg, wArg, hArg, cookie, fullArg, stepsArg] = process.argv
// Full-page capture on a console tab means the whole library grid, which is
// tens of thousands of pixels tall and simply never comes back. Off by default.
const full = String(fullArg) === 'full'
const width = Number(wArg || 390)
const height = Number(hArg || 1400)
const dark = String(themeArg) === '0'

const { spawn } = await import('node:child_process')
const fs = await import('node:fs/promises')

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--user-data-dir=' + (process.env.TMPDIR || '/tmp') + '/cdp-' + process.pid, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

const wsUrl = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('chrome did not report a devtools url')), 20000)
  chrome.stderr.on('data', (chunk) => {
    buffer += chunk
    const match = buffer.match(/ws:\/\/[^\s]+/)
    if (match) { clearTimeout(timer); resolve(match[0]) }
  })
})

const socket = new WebSocket(wsUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve))

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result ?? {})
    pending.delete(message.id)
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      if (pending.delete(id)) { console.error('timed out:', method); resolve({}) }
    }, 15000)
    pending.set(id, (result) => { clearTimeout(timer); resolve(result) })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

await send('Emulation.setDeviceMetricsOverride',
  { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId)
await send('Emulation.setEmulatedMedia',
  { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sessionId)
if (cookie) {
  const [name, ...rest] = cookie.split('=')
  const origin = new URL(url).origin
  await send('Network.enable', {}, sessionId)
  await send('Network.setCookie',
    { name, value: rest.join('='), url: origin, path: '/' }, sessionId)
}
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url }, sessionId)
await new Promise((resolve) => setTimeout(resolve, 5000))

// Optional interaction: a JSON array of expressions, each evaluated in the page
// with a pause after it. This is how a screen behind a tab and a button — the
// plan editor, say — gets looked at rather than reasoned about.
for (const step of JSON.parse(stepsArg || '[]')) {
  const outcome = await send('Runtime.evaluate',
    { expression: step, returnByValue: true, awaitPromise: true }, sessionId)
  if (outcome.exceptionDetails) console.error('step failed:', step, outcome.exceptionDetails.text)
  await new Promise((resolve) => setTimeout(resolve, 2500))
}

const shot = await send('Page.captureScreenshot',
  { format: 'png', captureBeyondViewport: full }, sessionId)
await fs.writeFile(out, Buffer.from(shot.data, 'base64'))
console.log(out, (await fs.stat(out)).size + ' bytes')
chrome.kill()
process.exit(0)
