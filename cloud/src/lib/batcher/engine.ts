/**
 * The Video Batcher processing engine — a module singleton that lives
 * OUTSIDE React (§34). Navigating the console away from the batcher page
 * unmounts the UI but never the engine: the worker pool keeps rendering.
 *
 *   UI (React)  →  engine (this file)  →  worker pool  →  ffmpeg.wasm  →  OPFS
 *
 * The engine owns:
 *   - the worker pool (reused across jobs, §8 — never a worker per job),
 *   - the scheduler, which pipelines probing / preparing / processing (§27),
 *   - deterministic manifests, built once per batch before anything renders,
 *   - progress aggregation with throttled store updates (§28),
 *   - output records backed by OPFS, exposed for download/preview (§29/30).
 *
 * Heavy media never passes through React state and is never copied into a
 * Blob unless the user asks for a download.
 */
import {
  buildManifest,
  effectiveDuration,
  type ManifestRequest,
} from './manifest'
import { buildFfmpegArgs } from './ffargs'
import { probeMp4 } from './probe-mp4'
import { detectCapabilities, enrichStorageQuota, recommendedWorkers, resolutionCategory } from './capabilities'
import { deleteOutput as opfsDelete, outputExists, readOutput } from './opfs'
import {
  batchPut,
  kvGet,
  kvSet,
  outputsAll,
  outputsDelete,
  outputsPut,
  presetDelete,
  presetPut,
  presetsAll,
  type StoredPreset,
} from './idb'
import { ExternalStore } from './store'
import { buildDefaultEffectSettings } from './effect-defs'
import { track } from './telemetry'
import type {
  Batch,
  Capabilities,
  EffectsConfig,
  EngineStatus,
  Job,
  JobProgress,
  MediaProbe,
  MetadataConfig,
  OutputRecord,
  PerfMetrics,
  RenderConfig,
  SourceFile,
  VariationManifest,
} from './types'

const WORKER_URL = '/vb/vb-worker.js'
const CORE_BASE = '/vb/ffmpeg/core'
const CORE_MT_BASE = '/vb/ffmpeg/core-mt'
const INIT_TIMEOUT_MS = 90_000
const PROGRESS_BUMP_MS = 250
const CONFIG_KEY = 'batcher.config'
const OUTPUTS_VERSION_KEY = 'batcher.outputs.version'
const OUTLETS_VERSION = 2

/* ------------------------------------------------------------------ types */

export type Notice = { id: string; tone: 'info' | 'warn' | 'error' | 'success'; title: string; message?: string }

export type SourceView = SourceFile

type SlotStatus = 'cold' | 'initializing' | 'ready' | 'busy' | 'dead'

type WorkerSlot = {
  index: number
  kind: 'st' | 'mt'
  worker: Worker | null
  status: SlotStatus
  busyJobId: string | null
  initMs: number | null
  syncAccess: boolean
  retireAfterJob: boolean
  failures: number
}

type PersistedConfig = {
  effects: EffectsConfig
  render: RenderConfig
  metadata: MetadataConfig
}

type ProbeRequest = { sourceId: string; file: File }

export type BatchStats = {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  overall: number
  etaSeconds: number | null
  elapsedSeconds: number
  throughputPerMinute: number | null
  activeWorkers: number
  workers: number
}

export type BatcherSnapshot = {
  booted: boolean
  opened: boolean
  engine: EngineStatus
  engineDetail: string
  engineLoadMs: number | null
  multithreaded: boolean
  capabilities: Capabilities | null
  config: PersistedConfig
  presets: StoredPreset[]
  sources: SourceView[]
  jobs: Job[]
  progress: Record<string, JobProgress>
  batch: Batch | null
  stats: BatchStats | null
  outputs: OutputRecord[]
  notices: Notice[]
  perf: PerfMetrics
  notice: string | null
  probeQueue: number
}

/* ---------------------------------------------------------------- helpers */

const defaultEffects = (): EffectsConfig => ({ settings: buildDefaultEffectSettings() })

function defaultConfig(): PersistedConfig {
  return {
    effects: defaultEffects(),
    render: { variations: 10, workers: 'auto', maxResolution: 'original', quality: 'balanced', seed: null },
    metadata: { stripGps: true, title: '', comment: '', variationTag: true },
  }
}

function defaultPerf(): PerfMetrics {
  return {
    engineLoadMs: null,
    timeToFirstProbeMs: null,
    timeToFirstRenderMs: null,
    lastBatchMs: null,
    lastBatchJobs: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    memoryFailures: 0,
    averageJobMs: null,
    workerBusyMs: 0,
    workerWallMs: 0,
    lastStages: null,
  }
}

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Friendly, specific errors (§43) built from the ffmpeg stderr tail. */
export function friendlyError(log: string, probe: MediaProbe | null): { message: string; kind: string } {
  const lower = (log || '').toLowerCase()
  if (/cannot enlarge memory|out of memory|oom|allocation failed|memory access out of bounds/.test(lower)) {
    return { message: 'Not enough browser memory is available for this operation. Try closing other tabs or reducing workers.', kind: 'memory' }
  }
  if (/invalid data found|moov atom not found|could not find codec parameters|decoder not found|unsupported|unknown decoder|no such filter|protocol not found/.test(lower)) {
    return { message: "This video format isn't supported by the browser processing engine.", kind: 'format' }
  }
  if (/error while decoding|invalid nal|corrupt|truncated|conversion failed/.test(lower)) {
    return { message: 'Processing failed while decoding this video.', kind: 'decode' }
  }
  if (!log.trim()) {
    return { message: 'The video processor stopped unexpectedly. Retry this variation.', kind: 'unknown' }
  }
  return { message: 'Processing failed. Retry this variation, or try a different source.', kind: 'unknown' }
}

function extOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,6})$/)
  return match ? match[1] : ''
}

const SUPPORTED_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'])

/* ---------------------------------------------------------------- engine */

class VideoBatcherEngineImpl {
  readonly store: ExternalStore<BatcherSnapshot>

  private booted = false
  private opening = false
  private status: EngineStatus = 'idle'
  private statusDetail = ''
  private bootStartedAt = 0
  private capabilities: Capabilities | null = null
  private multithreaded = false
  private threadsPerJob = 1

  private config: PersistedConfig = defaultConfig()
  private presets: StoredPreset[] = []
  private sources: SourceFile[] = []
  private files = new Map<string, File>()
  private probeQueue: ProbeRequest[] = []

  private slots: WorkerSlot[] = []
  private targetWorkers = 0

  private batch: Batch | null = null
  private jobs: Job[] = []
  private progress = new Map<string, JobProgress>()
  private progressBumpTimer: number | null = null

  private outputs: OutputRecord[] = []
  private notices: Notice[] = []
  private perf: PerfMetrics = defaultPerf()
  private notice: string | null = null
  private paused = false
  private runToken = 0
  private firstProbeAt: number | null = null
  private configSaveTimer: number | null = null
  private previewUrls = new Map<string, string>()

  constructor() {
    this.store = new ExternalStore<BatcherSnapshot>(this.snapshot())
  }

  /* ------------------------------------------------------------- lifecycle */

  open(): void {
    this.opening = true
    if (!this.booted) {
      this.booted = true
      this.bootStartedAt = performance.now()
      track('video_batcher_opened')
      void this.restore()
      void this.bootEngine()
    }
    this.bump()
  }

  close(): void {
    this.opening = false
  }

  private async restore(): Promise<void> {
    try {
      const stored = await kvGet<PersistedConfig>(CONFIG_KEY)
      if (stored?.effects?.settings?.length && stored.render && stored.metadata) {
        // Merge over defaults: a config saved before an effect existed must
        // still gain that effect (with its default) rather than lose rows.
        const defaults = defaultConfig()
        const settings = defaults.effects.settings.map(
          (setting) => stored.effects.settings.find((item) => item.id === setting.id) ?? setting,
        )
        this.config = {
          effects: { settings },
          render: { ...defaults.render, ...stored.render },
          metadata: { ...defaults.metadata, ...stored.metadata },
        }
      }
    } catch {
      /* first run */
    }
    try {
      const version = await kvGet<number>(OUTPUTS_VERSION_KEY)
      if (version !== OUTLETS_VERSION) {
        // Layout changed between versions; old rows would point at nothing.
        await import('./idb').then(({ outputsClear }) => outputsClear())
        await kvSet(OUTPUTS_VERSION_KEY, OUTLETS_VERSION)
      } else {
        const records = await outputsAll<OutputRecord>()
        this.outputs = records.sort((a, b) => b.createdAt - a.createdAt)
      }
    } catch {
      /* outputs are best-effort */
    }
    try {
      const records = await presetsAll()
      this.presets = records.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch {
      /* presets are optional */
    }
    this.bump()
    void this.pruneMissingOutputs()
  }

  /** Drop output records whose OPFS bytes are gone (storage cleared, eviction). */
  private async pruneMissingOutputs(): Promise<void> {
    const checks = await Promise.all(
      this.outputs.map(async (output) => ({ output, exists: await outputExists(output.batchId, output.fileName) })),
    )
    const missing = checks.filter((check) => !check.exists).map((check) => check.output.id)
    if (!missing.length) return
    this.outputs = this.outputs.filter((output) => !missing.includes(output.id))
    await Promise.all(missing.map((id) => outputsDelete(id).catch(() => undefined)))
    this.bump()
  }

  /* ------------------------------------------------------------ capabilities */

  private async bootEngine(): Promise<void> {
    this.status = 'loading'
    this.statusDetail = 'detecting browser capabilities'
    this.bump()

    let capabilities = detectCapabilities()
    capabilities = await enrichStorageQuota(capabilities)
    this.capabilities = capabilities

    if (!capabilities.wasm || !capabilities.workers) {
      this.status = 'limited'
      this.statusDetail = 'This browser cannot run local video processing. Try Chrome or Edge.'
      this.bump()
      return
    }
    if (!capabilities.opfs) {
      this.status = 'limited'
      this.statusDetail = 'This browser does not support local storage for video outputs. Try Chrome or Edge.'
      this.bump()
      return
    }

    this.multithreaded = capabilities.sharedArrayBuffer
    this.threadsPerJob = 1
    await this.ensureSlot(0)
  }

  private coreUrls(): { coreURL: string; wasmURL: string; workerURL: string } {
    const base = this.multithreaded ? CORE_MT_BASE : CORE_BASE
    return {
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
      workerURL: `${base}/ffmpeg-core.worker.js`,
    }
  }

  private async ensureSlot(index: number): Promise<void> {
    let slot = this.slots[index]
    if (slot?.worker && (slot.status === 'initializing' || slot.status === 'ready' || slot.status === 'busy')) return
    if (slot?.status === 'initializing') return
    // Do not hammer a hopeless init: two failures for a slot and it stays dead
    // until the page is reloaded.
    if ((slot?.failures ?? 0) >= 2) return

    const failures = slot?.failures ?? 0
    slot = {
      index,
      kind: this.multithreaded ? 'mt' : 'st',
      worker: null,
      status: 'initializing',
      busyJobId: null,
      initMs: null,
      syncAccess: this.capabilities?.opfsSyncAccess ?? false,
      retireAfterJob: false,
      failures,
    }
    this.slots[index] = slot

    try {
      const worker = new Worker(WORKER_URL)
      slot.worker = worker
      const token = this.runToken
      let settled = false

      const fail = (reason: string) => {
        slot!.failures += 1
        this.onSlotFailed(reason, index)
      }

      const watchdog = window.setTimeout(() => {
        if (settled) return
        settled = true
        worker.terminate()
        slot!.worker = null
        slot!.status = 'dead'
        fail('The processing engine did not finish loading. Check your connection and try again.')
      }, INIT_TIMEOUT_MS)

      worker.onmessage = (event: MessageEvent) => {
        const message = event.data as Record<string, unknown>
        if (message.t === 'ready') {
          if (settled) return
          settled = true
          window.clearTimeout(watchdog)
          slot!.initMs = Number(message.initMs) || performance.now() - this.bootStartedAt
          slot!.syncAccess = message.syncAccess === true
          slot!.status = 'ready'
          if (this.capabilities && slot!.syncAccess) {
            this.capabilities = { ...this.capabilities, opfsSyncAccess: true }
          }
          if (this.status !== 'ready') {
            this.status = 'ready'
            this.statusDetail = this.multithreaded
              ? 'Multithreaded processing engine ready.'
              : 'Processing engine ready.'
            this.perf.engineLoadMs = this.perf.engineLoadMs ?? Math.round(performance.now() - this.bootStartedAt)
            track('engine_loaded', {
              engine_load_ms: this.perf.engineLoadMs ?? 0,
              engine: this.multithreaded ? 'wasm-mt' : 'wasm-st',
            })
          }
          this.bump()
          this.pump()
          return
        }
        if (message.t === 'init-error') {
          if (settled) return
          settled = true
          window.clearTimeout(watchdog)
          slot!.status = 'dead'
          slot!.worker = null
          worker.terminate()
          fail(
            this.multithreaded
              ? 'The processing engine failed to load. Falling back to single-threaded mode.'
              : 'The processing engine failed to load. Check your connection and try again.',
          )
          return
        }
        if (token !== this.runToken && message.t !== 'probe-done') {
          // A cancelled run's late messages are ignored.
          return
        }
        if (message.t === 'progress') this.onProgress(message)
        else if (message.t === 'done') void this.onJobDone(slot!, message)
        else if (message.t === 'job-error') this.onJobError(slot!, message)
      }

      worker.onerror = () => {
        if (settled) return
        settled = true
        window.clearTimeout(watchdog)
        slot!.status = 'dead'
        slot!.worker = null
        worker.terminate()
        fail('The processing engine crashed while loading. It will be retried.')
      }

      worker.postMessage({
        t: 'init',
        kind: slot.kind,
        startedAt: performance.now(),
        ...this.coreUrls(),
      })
    } catch (error) {
      slot.status = 'dead'
      slot.failures += 1
      this.onSlotFailed(String((error as Error)?.message ?? error), index)
    }
  }

  private onSlotFailed(message: string, index = 0): void {
    const anyAlive = this.slots.some((slot) => slot.status === 'ready' || slot.status === 'initializing' || slot.status === 'busy')
    if (this.multithreaded && !this.hasHadReadySlot()) {
      // Automatic multithreading fallback (§9).
      this.multithreaded = false
      this.requeueBusyJobs()
      this.pushNotice('warn', 'Multithreaded processing unavailable', 'Falling back to single-threaded processing automatically.')
      void this.ensureSlot(0)
      return
    }
    if (!anyAlive) {
      const batchRunning = this.batch?.status === 'running' || this.batch?.status === 'paused'
      this.status = 'error'
      this.statusDetail = message
      if (batchRunning) {
        this.failBatch(message)
      }
    } else if (this.batch?.status === 'running') {
      // One slot of several died (crash, OOM). Replace it; the pool keeps the
      // guarantee that a failed variation never kills the batch (§26).
      this.pushNotice('warn', 'A worker was replaced', message)
      window.setTimeout(() => {
        void this.ensureSlot(index)
      }, 500)
    }
    this.bump()
  }

  /** A slot died mid-job (fallback, crash): its job returns to the queue. */
  private requeueBusyJobs(): void {
    const now = Date.now()
    let changed = false
    this.slots = this.slots.map((slot) => {
      if (!slot.busyJobId) return slot
      const job = this.jobs.find((item) => item.id === slot.busyJobId)
      if (job && job.status === 'processing') {
        this.progress.delete(job.id)
        this.jobs = this.jobs.map((item) =>
          item.id === job.id ? { ...item, status: 'queued', stage: null, startedAt: null, finishedAt: null } : item,
        )
        changed = true
      }
      slot.worker?.terminate()
      return { ...slot, worker: null, busyJobId: null, status: 'cold' as const }
    })
    if (changed) {
      void now
      this.bump()
    }
  }

  private hasHadReadySlot(): boolean {
    return this.slots.some((slot) => slot.initMs != null)
  }

  /* ---------------------------------------------------------------- sources */

  addFiles(fileList: File[]): void {
    const accepted: File[] = []
    const rejected: string[] = []
    for (const file of fileList) {
      const ext = extOf(file.name)
      const videoish = file.type.startsWith('video/') || file.type === 'application/octet-stream' || file.type === ''
      if (SUPPORTED_EXTENSIONS.has(ext) && videoish) accepted.push(file)
      else rejected.push(file.name)
    }

    if (rejected.length) {
      this.pushNotice(
        'warn',
        rejected.length === 1 ? 'File skipped' : `${rejected.length} files skipped`,
        'Video Batcher reads video files (MP4, MOV, M4V, WEBM, MKV, AVI).',
      )
    }
    if (!accepted.length) return

    const created: SourceFile[] = accepted.map((file) => ({
      id: uid(),
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      status: 'probing',
      probe: null,
      error: null,
      addedAt: Date.now(),
    }))

    created.forEach((source, index) => this.files.set(source.id, accepted[index]))
    this.sources = [...this.sources, ...created]
    this.bump()

    for (const source of created) {
      void this.probeSource(source)
    }
  }

  private async probeSource(source: SourceFile): Promise<void> {
    const file = this.files.get(source.id)
    if (!file) return
    const probeStart = performance.now()
    const ext = extOf(source.name)

    let probe: MediaProbe | null = null
    if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') {
      const mp4 = await probeMp4(file)
      if (mp4) {
        probe = {
          ...mp4,
          fileSize: file.size,
          source: 'mp4',
        }
      }
    }

    if (!probe) {
      // Fallback: ffprobe inside a worker (§14, probing never blocks the UI).
      const result = await this.runFfprobe(source, file)
      if (result) probe = result
    }

    const sourceIndex = this.sources.findIndex((item) => item.id === source.id)
    if (sourceIndex < 0) return

    const next = [...this.sources]
    if (probe && probe.hasVideo) {
      next[sourceIndex] = { ...source, status: 'ready', probe, error: null }
      const elapsed = Math.round(performance.now() - probeStart)
      this.perf.timeToFirstProbeMs = this.perf.timeToFirstProbeMs ?? elapsed
      // Jobs queued while this source was still being read were planned on a
      // placeholder probe. Re-derive their manifests from the real one — same
      // batch seed, same index, so the new settings are the deterministic
      // ones for that variation.
      this.replanWaitingJobs(source.id, probe)
    } else {
      next[sourceIndex] = {
        ...source,
        status: 'error',
        probe: null,
        error: "This video format isn't supported by the browser processing engine.",
      }
    }
    this.sources = next
    this.bump()
    this.pump()
  }

  private probeWaiters = new Map<string, (value: MediaProbe | null) => void>()

  /** Rebuild manifests for queued jobs whose source just finished probing. */
  private replanWaitingJobs(sourceId: string, probe: MediaProbe): void {
    if (!this.jobs.some((job) => job.sourceId === sourceId && job.status === 'queued' && job.stage === 'waiting-source')) {
      return
    }
    const source = this.sources.find((item) => item.id === sourceId)
    if (!source) return
    const batch = this.batch
    this.jobs = this.jobs.map((job) => {
      if (job.sourceId !== sourceId || job.status !== 'queued' || job.stage !== 'waiting-source') return job
      const manifest = buildManifest({
        batchId: job.batchId,
        batchSeed: Number(batch?.seed ?? 0),
        variationIndex: job.variationIndex,
        jobId: job.id,
        sourceId: job.sourceId,
        sourceName: source.name,
        probe,
        effects: batch?.effects ?? this.config.effects,
        render: batch?.config ?? this.config.render,
        metadata: batch?.metadata ?? this.config.metadata,
      })
      return { ...job, manifest, seed: manifest.seed, stage: null }
    })
    this.bump()
    this.pump()
  }

  private runFfprobe(source: SourceFile, file: File): Promise<MediaProbe | null> {
    return new Promise((resolve) => {
      this.probeQueue.push({ sourceId: source.id, file })
      this.probeWaiters.set(source.id, resolve)
      this.bump()
      void this.flushProbeQueue()
    })
  }

  private probeBusy = false

  private async flushProbeQueue(): Promise<void> {
    if (this.probeBusy) return
    this.probeBusy = true
    try {
      while (this.probeQueue.length) {
        if (this.status === 'limited' || this.status === 'error') {
          for (const item of this.probeQueue) this.probeWaiters.get(item.sourceId)?.(null)
          this.probeWaiters.clear()
          this.probeQueue = []
          break
        }
        const slot = this.slots.find((item) => item.status === 'ready')
        if (!slot) {
          const hasLiveSlot = this.slots.some(
            (item) => item.status === 'ready' || item.status === 'initializing' || item.status === 'busy',
          )
          if (!hasLiveSlot) {
            for (const pending of this.probeQueue) this.probeWaiters.get(pending.sourceId)?.(null)
            this.probeWaiters.clear()
            this.probeQueue = []
            break
          }
          await this.waitForReadySlot()
          continue
        }
        const item = this.probeQueue.shift()
        if (!item) continue
        const waiter = this.probeWaiters.get(item.sourceId)
        this.probeWaiters.delete(item.sourceId)
        if (!waiter) continue
        const safeName = `probe.${extOf(item.file.name) || 'mp4'}`
        const mountFile = new File([item.file], safeName, { type: item.file.type })
        slot.status = 'busy'
        const result = await new Promise<MediaProbe | null>((resolve) => {
          const handler = (event: MessageEvent) => {
            const message = event.data as Record<string, unknown>
            if (message.t !== 'probe-done') return
            slot.worker?.removeEventListener('message', handler)
            slot.status = 'ready'
            resolve(this.parseProbeJson(message))
          }
          slot.worker?.addEventListener('message', handler)
          slot.worker?.postMessage({ t: 'probe', id: item.sourceId, file: mountFile })
        })
        waiter(result)
        this.bump()
      }
    } finally {
      this.probeBusy = false
    }
  }

  private waitForReadySlot(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        unsubscribe()
        resolve()
      }, 60_000)
      const unsubscribe = this.store.subscribe(() => {
        if (this.slots.some((slot) => slot.status === 'ready' || slot.status === 'dead')) {
          window.clearTimeout(timeout)
          unsubscribe()
          resolve()
        }
      })
    })
  }

  private parseProbeJson(message: Record<string, unknown>): MediaProbe | null {
    if (message.ok !== true || typeof message.json !== 'string') return null
    try {
      const parsed = JSON.parse(message.json) as {
        streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; channels?: number; sample_rate?: string; tags?: { rotate?: string } }[]
        format?: { duration?: string; bit_rate?: string }
      }
      const streams = parsed.streams ?? []
      const video = streams.find((stream) => stream.codec_type === 'video')
      const audio = streams.find((stream) => stream.codec_type === 'audio')
      if (!video) return null
      const rate = video.avg_frame_rate ?? video.r_frame_rate ?? '0/1'
      const [num, den] = rate.split('/').map(Number)
      const fps = den ? num / den : null
      let rotation = Number(video.tags?.rotate ?? 0) || 0
      let width = video.width ?? null
      let height = video.height ?? null
      if ((rotation === 90 || rotation === 270) && width && height) {
        const swap = width
        width = height
        height = swap
      }
      return {
        durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
        width,
        height,
        fps: fps && fps > 0 && fps < 480 ? Math.round(fps * 100) / 100 : null,
        videoCodec: video.codec_name ?? null,
        audioCodec: audio?.codec_name ?? null,
        audioChannels: audio?.channels ?? null,
        sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
        bitrate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
        rotation: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
        fileSize: 0,
        hasVideo: true,
        hasAudio: Boolean(audio),
        source: 'ffprobe',
      }
    } catch {
      return null
    }
  }

  removeSource(id: string): void {
    this.sources = this.sources.filter((source) => source.id !== id)
    this.files.delete(id)
    this.bump()
  }

  clearSources(): void {
    this.sources = []
    this.files.clear()
    this.bump()
  }

  /* ----------------------------------------------------------------- config */

  setEffects(effects: EffectsConfig): void {
    this.config = { ...this.config, effects }
    this.saveConfig()
    this.bump()
  }

  setRender(patch: Partial<RenderConfig>): void {
    this.config = { ...this.config, render: { ...this.config.render, ...patch } }
    this.saveConfig()
    this.bump()
  }

  setMetadata(patch: Partial<MetadataConfig>): void {
    this.config = { ...this.config, metadata: { ...this.config.metadata, ...patch } }
    this.saveConfig()
    this.bump()
  }

  private saveConfig(): void {
    if (this.configSaveTimer != null) window.clearTimeout(this.configSaveTimer)
    this.configSaveTimer = window.setTimeout(() => {
      void kvSet(CONFIG_KEY, this.config)
    }, 300)
  }

  /* ---------------------------------------------------------------- presets */

  savePreset(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const record: StoredPreset = {
      id: uid(),
      name: trimmed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: JSON.parse(JSON.stringify(this.config)) as PersistedConfig,
    }
    this.presets = [record, ...this.presets]
    void presetPut(record).catch(() => undefined)
    this.bump()
  }

  applyPreset(id: string): void {
    const preset = this.presets.find((item) => item.id === id)
    if (!preset) return
    const config = preset.config as PersistedConfig
    if (!config?.effects?.settings?.length || !config.render || !config.metadata) {
      this.pushNotice('error', 'Preset is unreadable', 'It was saved by an incompatible version.')
      return
    }
    this.config = config
    this.saveConfig()
    this.bump()
    this.pushNotice('success', 'Preset loaded', preset.name)
  }

  renamePreset(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    this.presets = this.presets.map((preset) =>
      preset.id === id ? { ...preset, name: trimmed, updatedAt: Date.now() } : preset,
    )
    const record = this.presets.find((preset) => preset.id === id)
    if (record) void presetPut(record).catch(() => undefined)
    this.bump()
  }

  duplicatePreset(id: string): void {
    const preset = this.presets.find((item) => item.id === id)
    if (!preset) return
    const record: StoredPreset = {
      ...preset,
      id: uid(),
      name: `${preset.name} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: JSON.parse(JSON.stringify(preset.config)) as PersistedConfig,
    }
    this.presets = [record, ...this.presets]
    void presetPut(record).catch(() => undefined)
    this.bump()
  }

  deletePreset(id: string): void {
    this.presets = this.presets.filter((preset) => preset.id !== id)
    void presetDelete(id).catch(() => undefined)
    this.bump()
  }

  /* ------------------------------------------------------------------ batch */

  canGenerate(): { ok: boolean; reason?: string } {
    if (this.status !== 'ready' && this.status !== 'loading') {
      return { ok: false, reason: this.statusDetail || 'The processing engine is not available.' }
    }
    if (!this.sources.length) return { ok: false, reason: 'Add a video first.' }
    if (!this.sources.some((source) => source.status === 'ready' || source.status === 'probing')) {
      return { ok: false, reason: 'No readable video in the sources list.' }
    }
    if (!navigator.storage?.getDirectory) return { ok: false, reason: 'This browser cannot store video outputs locally.' }
    return { ok: true }
  }

  generate(): void {
    const check = this.canGenerate()
    if (!check.ok) {
      this.pushNotice('warn', 'Cannot start', check.reason)
      return
    }
    if (this.batch && (this.batch.status === 'running' || this.batch.status === 'paused')) {
      this.pushNotice('info', 'A batch is already running', 'Pause or cancel it before starting another.')
      return
    }

    const readySources = this.sources.filter((source) => source.status === 'ready' && source.probe)
    const pendingSources = this.sources.filter((source) => source.status === 'probing')
    if (!readySources.length && !pendingSources.length) {
      this.pushNotice('warn', 'Cannot start', 'No readable video in the sources list.')
      return
    }

    const seed = this.config.render.seed ?? Math.floor(Math.random() * 0x1fffffffffffff)
    const batchId = uid()
    const variations = Math.max(1, Math.min(500, Math.round(this.config.render.variations)))

    // Determinism first: every variation's resolved settings exist before a
    // single frame is decoded (§16).
    const jobs: Job[] = []
    let variationIndex = 0
    for (const source of [...readySources, ...pendingSources]) {
      for (let i = 0; i < variations; i += 1) {
        const jobId = uid()
        const request: ManifestRequest = {
          batchId,
          batchSeed: seed,
          variationIndex,
          jobId,
          sourceId: source.id,
          sourceName: source.name,
          probe:
            source.probe ??
            ({
              durationSeconds: null,
              width: 1080,
              height: 1920,
              fps: null,
              videoCodec: null,
              audioCodec: null,
              audioChannels: null,
              sampleRate: null,
              bitrate: null,
              rotation: 0,
              fileSize: source.size,
              hasVideo: true,
              hasAudio: false,
              source: 'mp4',
            } satisfies MediaProbe),
          effects: this.config.effects,
          render: this.config.render,
          metadata: this.config.metadata,
        }
        const manifest = buildManifest(request)
        jobs.push({
          id: jobId,
          batchId,
          sourceId: source.id,
          variationIndex,
          seed: manifest.seed,
          manifest,
          status: 'queued',
          stage: source.probe ? null : 'waiting-source',
          error: null,
          outputId: null,
          startedAt: null,
          finishedAt: null,
        })
        variationIndex += 1
      }
    }

    if (!jobs.length) {
      this.pushNotice('warn', 'Cannot start', 'No readable video in the sources list.')
      return
    }

    this.batch = {
      id: batchId,
      seed,
      status: 'running',
      total: jobs.length,
      startedAt: Date.now(),
      finishedAt: null,
      config: { ...this.config.render, variations },
      effects: this.config.effects,
      metadata: this.config.metadata,
    }
    this.jobs = jobs
    this.progress.clear()
    this.paused = false
    this.runToken += 1
    this.notice = null

    // Worker count per batch.
    const firstProbe = readySources[0]?.probe ?? null
    const weight = {
      megapixels: firstProbe ? ((firstProbe.width ?? 0) * (firstProbe.height ?? 0)) / 1_000_000 : 2,
      durationSeconds: firstProbe?.durationSeconds ?? null,
      fileBytes: readySources[0]?.size ?? 0,
    }
    const policy = recommendedWorkers(this.capabilities!, this.multithreaded, weight)
    let workers = this.config.render.workers === 'auto' ? policy.workers : Math.max(1, Math.min(6, this.config.render.workers))
    if (this.config.render.workers !== 'auto' && policy.reason) {
      // Explicit choice still respects the safety caps (§13).
      workers = Math.min(workers, policy.workers)
    }
    this.targetWorkers = workers
    this.threadsPerJob = this.multithreaded ? Math.max(1, Math.min(4, Math.floor((this.capabilities?.hardwareConcurrency ?? 4) / workers))) : 1

    if (policy.reason) {
      this.notice = 'Large job detected. Processing concurrency has been optimized automatically.'
    }

    for (let i = 0; i < workers; i += 1) void this.ensureSlot(i)
    // Trim surplus slots from a previous, wider batch.
    for (let i = workers; i < this.slots.length; i += 1) this.killSlot(i)

    track('batch_started', {
      variation_count: jobs.length,
      resolution_category: firstProbe ? resolutionCategory(firstProbe) : 'unknown',
      workers,
      engine: this.multithreaded ? 'wasm-mt' : 'wasm-st',
      quality: this.config.render.quality,
    })
    void this.persistBatch()
    this.bump()
    this.pump()
  }

  private async persistBatch(): Promise<void> {
    if (!this.batch) return
    const batch = this.batch
    try {
      await batchPut({
        id: batch.id,
        seed: batch.seed,
        startedAt: batch.startedAt,
        status: batch.status,
        total: batch.total,
        config: batch.config,
        effects: batch.effects,
        metadata: batch.metadata,
        manifests: this.jobs.map((job) => job.manifest),
      })
    } catch {
      /* best-effort */
    }
  }

  pause(): void {
    if (!this.batch || this.batch.status !== 'running') return
    this.paused = true
    this.batch = { ...this.batch, status: 'paused' }
    this.pushNotice('info', 'Queue paused', 'Active variations finish; nothing new starts until you resume.')
    this.bump()
  }

  resume(): void {
    if (!this.batch || this.batch.status !== 'paused') return
    this.paused = false
    this.batch = { ...this.batch, status: 'running' }
    this.bump()
    this.pump()
  }

  cancel(): void {
    if (!this.batch || this.batch.status === 'completed' || this.batch.status === 'cancelled') return
    this.runToken += 1
    this.paused = false
    const now = Date.now()
    for (const slot of this.slots) {
      if (slot.busyJobId) {
        slot.worker?.terminate()
        slot.worker = null
        slot.busyJobId = null
        slot.status = 'cold'
      }
    }
    this.jobs = this.jobs.map((job) => {
      if (job.status === 'processing') {
        this.progress.delete(job.id)
        return { ...job, status: 'cancelled', stage: null, finishedAt: now }
      }
      if (job.status === 'queued') return { ...job, status: 'cancelled', stage: null, finishedAt: now }
      return job
    })
    this.batch = { ...this.batch, status: 'cancelled', finishedAt: now }
    this.bump()
  }

  retryFailed(): void {
    if (!this.batch && !this.jobs.some((job) => job.status === 'failed')) return
    const hasFailed = this.jobs.some((job) => job.status === 'failed')
    if (!hasFailed) return
    this.jobs = this.jobs.map((job) =>
      job.status === 'failed'
        ? { ...job, status: 'queued', error: null, stage: null, startedAt: null, finishedAt: null }
        : job,
    )
    if (this.batch) {
      this.batch = { ...this.batch, status: 'running', finishedAt: null }
      this.paused = false
    }
    for (let i = 0; i < Math.max(1, this.targetWorkers); i += 1) void this.ensureSlot(i)
    this.bump()
    this.pump()
  }

  /* ------------------------------------------------------------- scheduler */

  private pump(): void {
    if (!this.batch || this.batch.status !== 'running' || this.paused) return
    const queued = this.jobs.filter((job) => job.status === 'queued')
    if (!queued.length) {
      this.maybeFinishBatch()
      return
    }

    for (const slot of this.slots) {
      if (slot.status !== 'ready') continue
      const job = queued.find((candidate) => this.sourceReady(candidate.sourceId))
      if (!job) break
      // Remove from the local queue so the same job is not dispatched twice.
      queued.splice(queued.indexOf(job), 1)
      this.dispatch(slot, job)
    }

    // No ready slot can take the next job: revive any missing worker up to
    // the batch's target so a crash mid-batch self-heals.
    if (queued.length) {
      const hasWorker = this.slots.some((slot) => slot.status === 'ready' || slot.status === 'busy' || slot.status === 'initializing')
      for (let i = 0; i < Math.max(1, this.targetWorkers); i += 1) {
        const slot = this.slots[i]
        const missing = !slot || slot.status === 'cold' || slot.status === 'dead'
        if (missing && (hasWorker || i === 0)) void this.ensureSlot(i)
      }
    }
  }

  private sourceReady(sourceId: string): boolean {
    const source = this.sources.find((item) => item.id === sourceId)
    return Boolean(source && source.status === 'ready' && source.probe && this.files.has(sourceId))
  }

  private dispatch(slot: WorkerSlot, job: Job): void {
    const source = this.sources.find((item) => item.id === job.sourceId)
    const file = this.files.get(job.sourceId)
    if (!source?.probe || !file || !slot.worker) return

    const extension = extOf(source.name) || 'mp4'
    const mountName = `input.${extension}`
    const mountFile = new File([file], mountName, { type: file.type })
    const args = buildFfmpegArgs(job.manifest, source.probe, {
      inputPath: `/in/${mountName}`,
      threads: this.threadsPerJob,
      multithreaded: this.multithreaded,
    })

    slot.status = 'busy'
    slot.busyJobId = job.id
    const startedAt = Date.now()
    const running: Job = {
      ...job,
      status: 'processing',
      stage: 'processing',
      startedAt,
    }
    if (this.perf.timeToFirstRenderMs == null && this.batch?.startedAt) {
      this.perf.timeToFirstRenderMs = startedAt - this.batch.startedAt
    }
    this.progress.set(job.id, { ratio: 0, outTimeSec: 0, fps: null, updatedAt: startedAt })
    this.jobs = this.jobs.map((item) => (item.id === job.id ? running : item))
    this.bump()

    slot.worker.postMessage({
      t: 'run',
      jobId: job.id,
      file: mountFile,
      args,
      outputName: job.manifest.export.outputName,
      opfsName: job.manifest.export.outputName,
      batchDir: job.batchId,
      durationSeconds: effectiveDuration(job.manifest, source.probe),
    })
  }

  private onProgress(message: Record<string, unknown>): void {
    const jobId = String(message.jobId)
    const job = this.jobs.find((item) => item.id === jobId)
    if (!job || job.status !== 'processing') return
    const ratio = typeof message.ratio === 'number' ? (message.ratio as number) : null
    const outTimeSec = Number(message.outTimeSec) || 0
    const fps = typeof message.fps === 'number' ? (message.fps as number) : null
    this.progress.set(jobId, {
      ratio: ratio ?? 0,
      outTimeSec,
      fps,
      updatedAt: Date.now(),
    })
    // Throttle store updates: the worker posts at ~5/s, React sees ~4/s (§28).
    if (this.progressBumpTimer == null) {
      this.progressBumpTimer = window.setTimeout(() => {
        this.progressBumpTimer = null
        this.bump()
      }, PROGRESS_BUMP_MS)
    }
  }

  private async onJobDone(slot: WorkerSlot, message: Record<string, unknown>): Promise<void> {
    const jobId = String(message.jobId)
    const job = this.jobs.find((item) => item.id === jobId)
    slot.busyJobId = null
    if (!job || job.status !== 'processing') {
      // A stale finish (cancelled and re-run): hand the worker straight back.
      slot.status = slot.retireAfterJob ? 'dead' : 'ready'
      if (slot.retireAfterJob) {
        slot.worker?.terminate()
        slot.worker = null
      }
      this.pump()
      return
    }

    const ret = Number(message.ret) || 0
    const exists = message.exists === true
    const outputBytes = Number(message.outputBytes) || 0
    const stages = (message.stages ?? {}) as { mountMs?: number; execMs?: number; readMs?: number }

    // Large jobs leave the wasm heap high-water mark behind; recycle the slot
    // after a big write instead of carrying it into every later job (§12).
    if (outputBytes > 200 * 1024 * 1024) slot.retireAfterJob = true
    slot.status = slot.retireAfterJob ? 'dead' : 'ready'
    if (slot.retireAfterJob) {
      slot.worker?.terminate()
      slot.worker = null
    }

    if (ret !== 0 || !exists || outputBytes <= 0) {
      const probe = this.sources.find((item) => item.id === job.sourceId)?.probe ?? null
      const friendly = friendlyError(String(message.log ?? ''), probe)
      if (friendly.kind === 'memory') this.perf.memoryFailures += 1
      this.finishJob(job, 'failed', friendly.message)
      this.pump()
      return
    }

    const source = this.sources.find((item) => item.id === job.sourceId)
    const output: OutputRecord = {
      id: uid(),
      jobId: job.id,
      batchId: job.batchId,
      sourceId: job.sourceId,
      variationIndex: job.variationIndex,
      name: job.manifest.export.outputName,
      fileName: job.manifest.export.outputName,
      sizeBytes: outputBytes,
      createdAt: Date.now(),
      width: job.manifest.export.canvasWidth,
      height: job.manifest.export.canvasHeight,
      durationSeconds: source?.probe ? effectiveDuration(job.manifest, source.probe) : null,
    }
    this.outputs = [output, ...this.outputs]
    void outputsPut(output).catch(() => undefined)

    const startedAt = job.startedAt ?? Date.now()
    const processingMs = stages.execMs ?? Date.now() - startedAt
    this.perf.jobsCompleted += 1
    this.perf.averageJobMs =
      this.perf.averageJobMs == null
        ? processingMs
        : (this.perf.averageJobMs * (this.perf.jobsCompleted - 1) + processingMs) / this.perf.jobsCompleted
    this.perf.lastStages = {
      engineLoadMs: this.perf.engineLoadMs,
      probeMs: null,
      inputWriteMs: Math.round(stages.mountMs ?? 0),
      ffmpegStartMs: null,
      processingMs: Math.round(stages.execMs ?? 0),
      outputReadMs: Math.round(stages.readMs ?? 0),
    }
    track('variation_completed', { processing_seconds: Math.round(processingMs / 100) / 10 })

    this.finishJob(job, 'completed', null, output.id)
    this.pump()
  }

  private onJobError(slot: WorkerSlot, message: Record<string, unknown>): void {
    const jobId = String(message.jobId)
    const job = this.jobs.find((item) => item.id === jobId)
    slot.busyJobId = null
    slot.status = 'ready'
    if (!job || job.status !== 'processing') {
      this.pump()
      return
    }
    const friendly = friendlyError(String(message.log ?? message.message ?? ''), null)
    if (friendly.kind === 'memory') this.perf.memoryFailures += 1
    this.finishJob(job, 'failed', friendly.message)
    this.pump()
  }

  private finishJob(job: Job, status: 'completed' | 'failed', error: string | null, outputId?: string): void {
    const finishedAt = Date.now()
    this.jobs = this.jobs.map((item) =>
      item.id === job.id
        ? { ...item, status, error, outputId: outputId ?? null, stage: null, finishedAt }
        : item,
    )
    if (status === 'failed') this.perf.jobsFailed += 1
    this.progress.delete(job.id)
    this.bump()
  }

  private maybeFinishBatch(): void {
    if (!this.batch) return
    if (this.jobs.some((job) => job.status === 'queued' || job.status === 'processing')) return
    if (this.batch.status === 'completed' || this.batch.status === 'cancelled' || this.batch.status === 'partial') return

    const completed = this.jobs.filter((job) => job.status === 'completed').length
    const failed = this.jobs.filter((job) => job.status === 'failed').length
    const cancelled = this.jobs.filter((job) => job.status === 'cancelled').length
    const finishedAt = Date.now()
    let status: Batch['status'] = 'completed'
    if (cancelled > 0) status = 'cancelled'
    else if (failed > 0) status = completed > 0 ? 'partial' : 'failed'

    this.batch = { ...this.batch, status, finishedAt }
    if (this.batch.startedAt) {
      this.perf.lastBatchMs = finishedAt - this.batch.startedAt
      this.perf.lastBatchJobs = this.jobs.length
    }
    if (status === 'completed') {
      track('batch_completed', {
        variation_count: this.jobs.length,
        processing_seconds: Math.round((this.perf.lastBatchMs ?? 0) / 1000),
      })
    } else if (status === 'failed' || status === 'partial') {
      track('batch_failed', { variation_count: this.jobs.length, failed })
    }
    void this.persistBatch()
    this.bump()
  }

  private failBatch(message: string): void {
    const now = Date.now()
    this.jobs = this.jobs.map((job) =>
      job.status === 'queued' || job.status === 'processing'
        ? { ...job, status: 'failed', stage: null, error: message, finishedAt: now }
        : job,
    )
    if (this.batch) this.batch = { ...this.batch, status: 'partial', finishedAt: now }
    this.bump()
  }

  /* ---------------------------------------------------------------- outputs */

  async downloadOutput(outputId: string, saveAs = false): Promise<void> {
    const record = this.outputs.find((item) => item.id === outputId)
    if (!record) return
    const file = await readOutput(record.batchId, record.fileName)
    if (!file) {
      this.pushNotice('error', 'Output missing', 'The file is no longer in local storage. Re-run this variation.')
      await outputsDelete(record.id)
      this.outputs = this.outputs.filter((item) => item.id !== record.id)
      this.bump()
      return
    }

    const picker = window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName?: string
        types?: { description: string; accept: Record<string, string[]> }[]
      }) => Promise<FileSystemFileHandle>
    }
    if (saveAs && typeof picker.showSaveFilePicker === 'function') {
      try {
        const handle = await picker.showSaveFilePicker({ suggestedName: record.name })
        const writable = await handle.createWritable()
        await file.stream().pipeTo(writable)
        return
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') return
        // Fall through to the anchor download.
      }
    }
    this.anchorDownload(file, record.name)
  }

  private anchorDownload(file: File, name: string): void {
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  async previewUrl(outputId: string): Promise<string | null> {
    const existing = this.previewUrls.get(outputId)
    if (existing) return existing
    const record = this.outputs.find((item) => item.id === outputId)
    if (!record) return null
    const file = await readOutput(record.batchId, record.fileName)
    if (!file) return null
    const url = URL.createObjectURL(file)
    // Keep at most three previews alive; revoke the oldest.
    if (this.previewUrls.size >= 3) {
      const oldest = this.previewUrls.keys().next().value as string | undefined
      if (oldest) this.releasePreview(oldest)
    }
    this.previewUrls.set(outputId, url)
    return url
  }

  releasePreview(outputId: string): void {
    const url = this.previewUrls.get(outputId)
    if (url) {
      URL.revokeObjectURL(url)
      this.previewUrls.delete(outputId)
    }
  }

  async deleteOutput(outputId: string): Promise<void> {
    const record = this.outputs.find((item) => item.id === outputId)
    if (!record) return
    this.releasePreview(outputId)
    await opfsDelete(record.batchId, record.fileName)
    await outputsDelete(record.id).catch(() => undefined)
    this.outputs = this.outputs.filter((item) => item.id !== outputId)
    this.bump()
  }

  async downloadAll(): Promise<void> {
    const records = this.outputs.filter((output) => output.batchId === this.batch?.id)
    const list = records.length ? records : this.outputs
    for (const record of list) {
      await this.downloadOutput(record.id, false)
      // Browsers throttle rapid programmatic downloads; a beat between files
      // keeps every one of them.
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }

  /* ------------------------------------------------------------------ misc */

  dismissNotice(id: string): void {
    this.notices = this.notices.filter((notice) => notice.id !== id)
    this.bump()
  }

  private pushNotice(tone: Notice['tone'], title: string, message?: string): void {
    const notice: Notice = { id: uid(), tone, title, message }
    this.notices = [...this.notices.slice(-3), notice]
    this.bump()
  }

  private killSlot(index: number): void {
    const slot = this.slots[index]
    if (!slot) return
    slot.worker?.terminate()
    this.slots[index] = { ...slot, worker: null, status: 'cold', busyJobId: null }
  }

  /* -------------------------------------------------------------- snapshots */

  private stats(): BatchStats | null {
    if (!this.batch) return null
    const total = this.jobs.length
    let queued = 0
    let processing = 0
    let completed = 0
    let failed = 0
    let cancelled = 0
    let activeFraction = 0
    for (const job of this.jobs) {
      if (job.status === 'queued') queued += 1
      else if (job.status === 'processing') {
        processing += 1
        activeFraction += this.progress.get(job.id)?.ratio ?? 0
      } else if (job.status === 'completed') completed += 1
      else if (job.status === 'failed') failed += 1
      else if (job.status === 'cancelled') cancelled += 1
    }
    const done = completed + failed + cancelled
    const overall = total ? Math.max(0, Math.min(1, (done + activeFraction) / total)) : 0
    const elapsedSeconds = this.batch.startedAt ? Math.max(0, (Date.now() - this.batch.startedAt) / 1000) : 0
    let etaSeconds: number | null = null
    if (this.batch.status === 'running' && overall > 0.03 && elapsedSeconds > 3) {
      const remaining = elapsedSeconds * ((1 - overall) / overall)
      etaSeconds = remaining < 6 * 3600 ? remaining : null
    }
    return {
      total,
      queued,
      processing,
      completed,
      failed,
      cancelled,
      overall,
      etaSeconds,
      elapsedSeconds,
      throughputPerMinute: elapsedSeconds > 10 ? completed / (elapsedSeconds / 60) : null,
      activeWorkers: this.slots.filter((slot) => slot.status === 'busy').length,
      workers: Math.max(1, this.targetWorkers || 1),
    }
  }

  private snapshot(): BatcherSnapshot {
    return {
      booted: this.booted,
      opened: this.opening,
      engine: this.status,
      engineDetail: this.statusDetail,
      engineLoadMs: this.perf.engineLoadMs,
      multithreaded: this.multithreaded,
      capabilities: this.capabilities,
      config: this.config,
      presets: this.presets,
      sources: this.sources,
      jobs: this.jobs,
      progress: Object.fromEntries(this.progress),
      batch: this.batch,
      stats: this.stats(),
      outputs: this.outputs,
      notices: this.notices,
      perf: this.perf,
      notice: this.notice,
      probeQueue: this.probeQueue.length,
    }
  }

  private bump(): void {
    this.store.set(this.snapshot())
  }
}

let engine: VideoBatcherEngineImpl | null = null

export function getBatcherEngine(): VideoBatcherEngineImpl {
  if (!engine) {
    engine = new VideoBatcherEngineImpl()
    // Automation hook: the smoke test (scripts/batcher-smoke.mjs) drives the
    // engine directly because it cannot click through a headless UI. A bare
    // singleton reference — no data, no credentials.
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __vbEngine?: VideoBatcherEngineImpl }).__vbEngine = engine
    }
  }
  return engine
}

export type BatcherEngine = VideoBatcherEngineImpl
