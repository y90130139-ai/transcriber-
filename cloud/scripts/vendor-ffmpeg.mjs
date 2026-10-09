/**
 * Copies the FFmpeg WASM cores out of node_modules into public/vb/ffmpeg so the
 * browser can load them same-origin (no CDN dependency, HTTP-cacheable, and
 * safe under any deploy's CSP).
 *
 * Two cores are vendored:
 *   core    — single-threaded. Always available. The default.
 *   core-mt — multithreaded. Only loaded when the page is cross-origin
 *             isolated (SharedArrayBuffer); see next.config.ts headers.
 *
 * The mt build preallocates a 32-worker pthread pool (ffmpeg.wasm's own
 * default). One Video Batcher worker runs one ffmpeg instance, so 32 pthread
 * workers per instance is fat for no benefit — the pool size is patched down
 * to 4, which is what a `-threads 4` budget can actually use.
 *
 * Runs on postinstall and before dev/build. Idempotent: matching file sizes
 * skip the copy.
 */
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'vb', 'ffmpeg')

const JOBS = [
  { from: '@ffmpeg/core/dist/umd', to: 'core' },
  { from: '@ffmpeg/core-mt/dist/umd', to: 'core-mt' },
]

const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']

async function sameFile(source, target) {
  try {
    const [a, b] = await Promise.all([stat(source), stat(target)])
    return a.size === b.size
  } catch {
    return false
  }
}

async function copyJob(job) {
  const sourceDir = join(root, 'node_modules', ...job.from.split('/'))
  if (!existsSync(sourceDir)) {
    console.warn(`[vendor-ffmpeg] missing ${job.from} — skipped`)
    return false
  }
  const targetDir = join(out, job.to)
  await mkdir(targetDir, { recursive: true })
  for (const name of FILES) {
    const source = join(sourceDir, name)
    if (!existsSync(source)) {
      // The single-threaded core ships no .worker.js.
      continue
    }
    const target = join(targetDir, name)
    if (await sameFile(source, target)) continue
    await copyFile(source, target)
    console.log(`[vendor-ffmpeg] ${job.to}/${name}`)
  }
  return true
}

async function patchMtPoolSize() {
  const target = join(out, 'core-mt', 'ffmpeg-core.js')
  if (!existsSync(target)) return
  const source = await readFile(target, 'utf8')
  if (!source.includes('pthreadPoolSize=32')) {
    if (!source.includes('pthreadPoolSize=4')) {
      console.warn('[vendor-ffmpeg] pthread pool marker not found — mt left unpatched')
    }
    return
  }
  await writeFile(target, source.replace('pthreadPoolSize=32', 'pthreadPoolSize=4'))
  console.log('[vendor-ffmpeg] core-mt pthread pool capped at 4')
}

await copyJob(JOBS[0])
await copyJob(JOBS[1])
await patchMtPoolSize()
console.log('[vendor-ffmpeg] ready in public/vb/ffmpeg')
