/**
 * Video Batcher processing worker.
 *
 * A classic (non-module) worker so `importScripts` can pull in the ffmpeg.wasm
 * UMD core. It is deliberately dumb: the main thread owns the domain logic
 * (manifests, filter graphs, scheduling); this worker only:
 *
 *   1. boots an ffmpeg-core instance (single-threaded, or multithreaded when
 *      the page is cross-origin isolated),
 *   2. mounts the source file lazily through WORKERFS (zero-copy — the File
 *      handle is cloned into the worker, bytes stay on disk),
 *   3. runs the exact argument vector it is handed, reporting progress,
 *   4. streams the output out of MEMFS into OPFS in fixed-size chunks and
 *      frees the MEMFS copy immediately,
 *   5. serves ffprobe for containers the fast JS prober cannot read.
 *
 * One instance handles one job at a time. Cancellation is the pool's job:
 * the main thread terminates this worker, and a fresh one replaces it.
 * Keeping cancellation out of the worker avoids unreachable states inside
 * an execution that cannot be interrupted from JS (ffmpeg runs the whole
 * command in one synchronous call).
 */

const CHUNK_BYTES = 4 * 1024 * 1024
const EXPORTS_DIR = 'vb-exports'
const PROGRESS_INTERVAL_MS = 180

let core = null
let coreKind = null

function post(message) {
  self.postMessage(message)
}

async function boot(config) {
  const started = performance.now()
  const coreURL = config.coreURL
  const wasmURL = config.wasmURL
  const workerURL = config.workerURL

  importScripts(coreURL)
  // The UMD build exposes the factory as a global.
  const factory = self.createFFmpegCore
  if (typeof factory !== 'function') throw new Error('ffmpeg core factory missing')

  // The core resolves its .wasm (and pthread worker) through this JSON
  // payload — the same mechanism @ffmpeg/ffmpeg uses. locating by hand is
  // overwritten by the core itself, so this is the supported path.
  const payload = btoa(JSON.stringify({ wasmURL, workerURL }))
  core = await factory({ mainScriptUrlOrBlob: `${coreURL}#${payload}` })

  let logTail = []
  core.setLogger(({ type, message }) => {
    if (type === 'stderr') {
      logTail.push(message)
      if (logTail.length > 80) logTail = logTail.slice(-80)
    }
  })

  return {
    log: () => logTail.join('\n'),
  }
}

/** Reads the stderr tail captured by the booted core, for diagnostics. */
let logSink = () => ''

function attachProgress(jobId, durationSeconds) {
  let lastPost = 0
  let lastTime = 0
  let lastWall = performance.now()
  core.setProgress(({ time }) => {
    const now = performance.now()
    if (now - lastPost < PROGRESS_INTERVAL_MS) return
    const outTime = time / 1e6
    const delta = (outTime - lastTime) / Math.max(0.001, (now - lastWall) / 1000)
    lastPost = now
    lastTime = outTime
    lastWall = now
    post({
      t: 'progress',
      jobId,
      outTimeSec: outTime,
      durationSeconds,
      fps: delta > 0 ? delta : null,
      ratio: durationSeconds > 0 ? Math.max(0, Math.min(1, outTime / durationSeconds)) : null,
    })
  })
}

async function opfsWriter(batchDir, name) {
  const root = await navigator.storage.getDirectory()
  const exportsDir = await root.getDirectoryHandle(EXPORTS_DIR, { create: true })
  const dir = await batchDir ? await exportsDir.getDirectoryHandle(batchDir, { create: true }) : exportsDir
  const handle = await dir.getFileHandle(name, { create: true })

  // The sync access handle is the fast path (workers only). Fall back to the
  // writable stream where it is unsupported.
  try {
    const access = await handle.createSyncAccessHandle()
    return {
      write: async (view, at) => {
        access.write(view, { at })
      },
      close: async () => {
        access.flush()
        access.close()
      },
    }
  } catch {
    const stream = await handle.createWritable()
    return {
      write: async (view) => {
        await stream.write(view)
      },
      close: async () => {
        await stream.close()
      },
    }
  }
}

async function streamMemfsToOpfs(memfsPath, batchDir, name) {
  const size = core.FS.stat(memfsPath).size
  const writer = await opfsWriter(batchDir, name)
  const fh = core.FS.open(memfsPath, 'r')
  const buffer = new Uint8Array(CHUNK_BYTES)
  let offset = 0
  try {
    while (offset < size) {
      const want = Math.min(CHUNK_BYTES, size - offset)
      const read = core.FS.read(fh, buffer, 0, want, offset)
      if (read <= 0) break
      await writer.write(buffer.subarray(0, read), offset)
      offset += read
    }
  } finally {
    core.FS.close(fh)
    await writer.close()
  }
  return { size, bytesCopied: offset }
}

function mountInput(file, mountPoint) {
  core.FS.mkdir(mountPoint)
  core.FS.mount(core.FS.filesystems.WORKERFS, { files: [file] }, mountPoint)
}

function unmountInput(mountPoint) {
  try {
    core.FS.unmount(mountPoint)
  } catch {
    /* already gone */
  }
  try {
    core.FS.rmdir(mountPoint)
  } catch {
    /* already gone */
  }
}

async function runJob(job) {
  const stages = { mountMs: 0, execMs: 0, readMs: 0 }
  const inputMount = '/in'
  const outputName = job.outputName

  const mountStart = performance.now()
  mountInput(job.file, inputMount)
  stages.mountMs = performance.now() - mountStart

  attachProgress(job.jobId, job.durationSeconds)

  const execStart = performance.now()
  let ret = 1
  try {
    ret = core.exec(...job.args)
  } finally {
    stages.execMs = performance.now() - execStart
  }

  const outPath = `/${outputName}`
  const exists = ret === 0 && (() => {
    try {
      return core.FS.stat(outPath).size > 0
    } catch {
      return false
    }
  })()

  let outputBytes = 0
  if (exists) {
    const readStart = performance.now()
    const result = await streamMemfsToOpfs(outPath, job.batchDir, job.opfsName)
    stages.readMs = performance.now() - readStart
    outputBytes = result.size
  }

  // Free the MEMFS copy and the mount immediately — the wasm heap never
  // shrinks, so the only defence is not holding two files in it at once.
  if (exists) {
    try {
      core.FS.unlink(outPath)
    } catch {
      /* already gone */
    }
  }
  unmountInput(inputMount)

  return { ret, exists, outputBytes, stages }
}

async function probeJob(job) {
  const inputMount = '/in'
  mountInput(job.file, inputMount)
  const outPath = '/probe.json'
  let ret = 1
  try {
    ret = core.ffprobe(
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-o', outPath,
      `${inputMount}/${job.file.name}`,
    )
    if (ret === 0) {
      const text = new TextDecoder().decode(core.FS.readFile(outPath))
      return { ret, ok: true, json: text }
    }
    return { ret, ok: false, log: logSink() }
  } finally {
    try {
      core.FS.unlink(outPath)
    } catch {
      /* not written */
    }
    unmountInput(inputMount)
  }
}

self.onmessage = async (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return

  if (message.t === 'init') {
    try {
      logSink = (await boot(message)).log
      coreKind = message.kind
      const syncAccess =
        typeof FileSystemFileHandle !== 'undefined' &&
        typeof FileSystemFileHandle.prototype.createSyncAccessHandle === 'function'
      post({ t: 'ready', kind: coreKind, syncAccess, initMs: performance.now() - message.startedAt })
    } catch (error) {
      post({ t: 'init-error', kind: message.kind, message: String(error && error.message || error) })
    }
    return
  }

  if (!core) {
    post({ t: 'job-error', jobId: message.jobId, message: 'engine not initialised' })
    return
  }

  if (message.t === 'run') {
    try {
      const result = await runJob(message)
      post({
        t: 'done',
        jobId: message.jobId,
        ret: result.ret,
        exists: result.exists,
        outputBytes: result.outputBytes,
        stages: result.stages,
        log: result.ret === 0 ? '' : logSink(),
      })
    } catch (error) {
      post({
        t: 'job-error',
        jobId: message.jobId,
        message: String((error && error.message) || error),
        log: logSink ? logSink() : '',
      })
    }
    return
  }

  if (message.t === 'probe') {
    try {
      const result = await probeJob(message)
      post({ t: 'probe-done', ...result, id: message.id })
    } catch (error) {
      post({ t: 'probe-done', ok: false, ret: 1, log: String((error && error.message) || error), id: message.id })
    }
  }
}
