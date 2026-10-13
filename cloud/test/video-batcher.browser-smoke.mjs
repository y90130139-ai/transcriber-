// Manual browser integration smoke test.
// Start the built app on 3101 with SESSION_SECRET set, then launch Chrome with
// --remote-debugging-port=9222. This creates short real WebM/PNG fixtures in
// the browser, runs them through the local pipeline and checks verified jobs.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const baseUrl = process.env.VIDEO_BATCHER_BASE_URL ?? 'http://localhost:3101'
const cdpHttp = process.env.CHROME_CDP_HTTP ?? 'http://127.0.0.1:9222'
const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) throw new Error('Set SESSION_SECRET to the same local value used by the app server.')

function makeSessionToken() {
  const expires = Date.now() + 60 * 60 * 1000
  const signature = createHmac('sha256', sessionSecret).update(String(expires)).digest('base64url')
  return `${expires}.${signature}`
}

const targetResponse = await fetch(`${cdpHttp}/json/new?${baseUrl}/video-batcher`, { method: 'PUT' })
if (!targetResponse.ok) throw new Error(`Could not create a Chrome target (${targetResponse.status}).`)
const target = await targetResponse.json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextCommandId = 1
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})

function command(method, params = {}) {
  const id = nextCommandId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, timeout = 20_000) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    timeout,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

try {
  await command('Network.enable')
  await command('Network.setCookie', {
    name: 'tx_session',
    value: makeSessionToken(),
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Lax',
  })
  await command('Page.enable')
  await command('Page.navigate', { url: `${baseUrl}/video-batcher` })
  const loaded = await evaluate(`new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      if (document.querySelector('.video-batcher')) resolve(true);
      else if (Date.now() - started > 20000) resolve(false);
      else setTimeout(poll, 100);
    };
    poll();
  })`)
  assert.equal(loaded, true, 'authenticated Video Batcher route loaded')

  const videoFixture = await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(15);
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!mimeType) throw new Error('Headless Chrome does not support a WebM MediaRecorder codec.');
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const finished = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Fixture MediaRecorder failed.'));
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const file = new File([blob], 'browser smoke clip.webm', { type: blob.type });
        const input = document.querySelector('input[accept="video/*,image/*"]');
        const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        stream.getTracks().forEach((track) => track.stop());
        resolve({ bytes: blob.size, type: blob.type });
      };
    });
    recorder.start(100);
    const started = performance.now();
    const paint = (now) => {
      const hue = Math.round((now - started) / 12) % 360;
      context.fillStyle = 'hsl(' + hue + ' 70% 42%)'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff'; context.font = 'bold 26px sans-serif'; context.fillText('LOCAL TEST ' + Math.round((now - started) / 100), 20, 96);
      if (now - started >= 1100) recorder.stop(); else requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
    return await finished;
  })()`)
  assert.ok(videoFixture.bytes > 0, 'generated WebM fixture has bytes')

  const videoJob = await evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const row = document.querySelector('.vb-file-row');
      if (row?.textContent.includes('320 × 180')) resolve(row.textContent);
      else if (Date.now() - started > 15000) reject(new Error('Video fixture was not inspected.'));
      else setTimeout(poll, 100);
    };
    poll();
  })`)
  assert.match(videoJob, /browser smoke clip\.webm/)
  await evaluate(`(() => {
    const variations = [...document.querySelectorAll('input[type="number"]')].find((input) => input.min === '1' && input.max === '100');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(variations, '1');
    variations.dispatchEvent(new Event('input', { bubbles: true }));
    variations.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Generate variations')).click();
    [...document.querySelectorAll('.vb-tab')].find((button) => button.textContent.includes('Downloads')).click();
    return true;
  })()`)
  const videoResult = await evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const row = document.querySelector('.vb-job-row[data-status="completed"]');
      if (row) resolve(row.textContent);
      else if (document.querySelector('.vb-job-row[data-status="failed"]')) reject(new Error(document.querySelector('.vb-job-row[data-status="failed"]').textContent));
      else if (Date.now() - started > 30000) reject(new Error('Video export did not complete in 30 seconds.'));
      else setTimeout(poll, 100);
    };
    poll();
  })`, 35_000)
  assert.match(videoResult, /webm/i)
  assert.match(videoResult, /KB|MB|GB/)

  await evaluate(`(() => {
    [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Clear files').click();
    return true;
  })()`)
  await evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (!document.querySelector('.vb-file-row')) resolve(true);
      else if (Date.now() - started > 3000) reject(new Error('Could not clear video sources before the image check.'));
      else setTimeout(poll, 50);
    };
    poll();
  })`)

  const imageFixture = await evaluate(`new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d45b32'; context.fillRect(0, 0, 160, 120);
    context.fillStyle = '#fff'; context.fillRect(42, 28, 76, 64);
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Could not create PNG fixture.')); return; }
      const file = new File([blob], 'browser smoke still.png', { type: 'image/png' });
      const input = document.querySelector('input[accept="video/*,image/*"]');
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      resolve({ bytes: blob.size, type: blob.type });
    }, 'image/png');
  })`)
  assert.ok(imageFixture.bytes > 0, 'generated PNG fixture has bytes')
  await evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const count = document.querySelectorAll('.vb-file-row').length;
      if (count >= 1) {
        [...document.querySelectorAll('.vb-file-row .vb-file-select')].find((button) => button.textContent.includes('browser smoke still.png')).click();
        document.querySelector('.vb-process-actions .vb-button-primary').click();
        [...document.querySelectorAll('.vb-tab')].find((button) => button.textContent.includes('Downloads')).click();
        resolve(true);
      } else if (Date.now() - started > 10000) reject(new Error('PNG fixture was not inspected.'));
      else setTimeout(poll, 100);
    };
    poll();
  })`)
  const imageResult = await evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const row = [...document.querySelectorAll('.vb-job-row[data-status="completed"]')].find((item) => item.textContent.includes('browser-smoke-still'));
      if (row) resolve(row.textContent);
      else if ([...document.querySelectorAll('.vb-job-row[data-status="failed"]')].some((item) => item.textContent.includes('browser smoke still.png'))) reject(new Error('PNG export failed.'));
      else if (Date.now() - started > 15000) reject(new Error('Image export did not complete in 15 seconds.'));
      else setTimeout(poll, 100);
    };
    poll();
  })`, 20_000)
  assert.match(imageResult, /WEBP|PNG|JPEG|AVIF/i)

  console.log(JSON.stringify({ videoFixture, videoResult, imageFixture, imageResult }, null, 2))
} finally {
  socket.close()
  await fetch(`${cdpHttp}/json/close/${target.id}`).catch(() => undefined)
}
