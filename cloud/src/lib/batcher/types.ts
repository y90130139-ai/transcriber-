/**
 * Video Batcher domain types — browser edition.
 *
 * Deliberately the same shape as the desktop app's types (video-batcher
 * src/types/domain.ts) so the two products describe batches the same way and
 * a future cloud/desktop backend slotting in behind ProcessingBackend needs
 * no translation layer. Phase 1 carries the subset the browser engine runs;
 * later phases fill in captions, audio library, watermark, metadata.
 */

export const BATCHER_SCHEMA_VERSION = 1

/* ------------------------------------------------------------------ media */

export type MediaProbe = {
  durationSeconds: number | null
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  audioChannels: number | null
  sampleRate: number | null
  bitrate: number | null
  rotation: number
  fileSize: number
  hasVideo: boolean
  hasAudio: boolean
  /** Which prober produced this — 'mp4' (fast JS parse) or 'ffprobe'. */
  source: 'mp4' | 'ffprobe'
}

export type SourceStatus = 'importing' | 'probing' | 'ready' | 'error'

export type SourceFile = {
  id: string
  name: string
  size: number
  lastModified: number
  type: string
  status: SourceStatus
  probe: MediaProbe | null
  error: string | null
  addedAt: number
}

/* ---------------------------------------------------------------- effects */

export type EffectId =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'hue'
  | 'colorTemperature'
  | 'gamma'
  | 'zoom'
  | 'pixelShiftX'
  | 'pixelShiftY'
  | 'rotation'
  | 'mirror'
  | 'cutStart'
  | 'cutEnd'
  | 'speed'
  | 'sharpen'
  | 'noise'

export type EffectSetting = {
  id: EffectId
  enabled: boolean
  min: number
  max: number
  unit: string
  /** Only used by 'mirror'. */
  mode?: 'horizontal' | 'vertical' | null
}

export type EffectsConfig = {
  settings: EffectSetting[]
}

/* ------------------------------------------------------- output / render */

export type MaxResolution = 'original' | '1080p' | '720p'
export type QualityPreset = 'high' | 'balanced' | 'smaller'

export type RenderConfig = {
  variations: number
  /** 'auto' picks from cores, memory signals and job weight. */
  workers: number | 'auto'
  maxResolution: MaxResolution
  quality: QualityPreset
  seed: number | null
}

export type MetadataConfig = {
  stripGps: boolean
  title: string
  comment: string
  variationTag: boolean
}

export type ProjectConfig = {
  schemaVersion: number
  sources: never[]
  effects: EffectsConfig
  render: RenderConfig
  metadata: MetadataConfig
}

/* ----------------------------------------------------------- variation */

export type ResolvedVideo = {
  brightness: number
  contrast: number
  saturation: number
  hueDegrees: number
  temperature: number
  gamma: number
  zoom: number
  shiftXPercent: number
  shiftYPercent: number
  rotationDegrees: number
  mirror: 'horizontal' | 'vertical' | null
  speed: number
  cutStartSeconds: number
  cutEndSeconds: number | null
  sharpen: number
  noise: number
}

export type ResolvedExport = {
  outputName: string
  container: 'mp4'
  videoCodec: 'h264'
  audioCodec: 'aac' | 'copy'
  canvasWidth: number
  canvasHeight: number
  crf: number
  preset: string
  audioBitrateKbps: number
}

export type VariationManifest = {
  jobId: string
  batchId: string
  variationIndex: number
  seed: number
  sourceId: string
  video: ResolvedVideo
  metadata: MetadataConfig
  export: ResolvedExport
  /** True when the whole plan resolves to a remux (no re-encode needed). */
  streamCopy: boolean
}

/* ------------------------------------------------------------------ jobs */

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

export type JobStage = 'waiting-source' | 'processing' | 'writing'

export type Job = {
  id: string
  batchId: string
  sourceId: string
  variationIndex: number
  seed: number
  manifest: VariationManifest
  status: JobStatus
  stage: JobStage | null
  error: string | null
  outputId: string | null
  startedAt: number | null
  finishedAt: number | null
}

export type BatchStatus = 'idle' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled'

export type Batch = {
  id: string
  seed: number
  status: BatchStatus
  total: number
  startedAt: number | null
  finishedAt: number | null
  /** Frozen at Generate: later edits never change a running batch. */
  config: RenderConfig
  effects: EffectsConfig
  metadata: MetadataConfig
}

export type OutputRecord = {
  id: string
  jobId: string
  batchId: string
  sourceId: string
  variationIndex: number
  name: string
  /** OPFS path inside vb-exports/<batchId>/. */
  fileName: string
  sizeBytes: number
  createdAt: number
  width: number
  height: number
  durationSeconds: number | null
}

export type JobProgress = {
  ratio: number
  outTimeSec: number
  fps: number | null
  updatedAt: number
}

/* -------------------------------------------------------------- hardware */

export type WorkerCount = number

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'limited' | 'error'

export type Capabilities = {
  wasm: boolean
  workers: boolean
  sharedArrayBuffer: boolean
  crossOriginIsolated: boolean
  opfs: boolean
  opfsSyncAccess: boolean
  fileSystemAccess: boolean
  webCodecs: boolean
  hardwareConcurrency: number
  deviceMemoryGb: number | null
  storageQuotaBytes: number | null
}

export type StageTimings = {
  engineLoadMs: number | null
  probeMs: number | null
  inputWriteMs: number | null
  ffmpegStartMs: number | null
  processingMs: number | null
  outputReadMs: number | null
}

export type PerfMetrics = {
  engineLoadMs: number | null
  timeToFirstProbeMs: number | null
  timeToFirstRenderMs: number | null
  lastBatchMs: number | null
  lastBatchJobs: number
  jobsCompleted: number
  jobsFailed: number
  memoryFailures: number
  averageJobMs: number | null
  workerBusyMs: number
  workerWallMs: number
  lastStages: StageTimings | null
}
