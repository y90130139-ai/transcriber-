/**
 * The batch planner: turns a frozen config + a source probe into one
 * deterministic manifest per variation. All random decisions happen HERE and
 * are stored; rendering never draws a new value. Retry, regenerate and debug
 * therefore reproduce identical output settings (§16).
 */
import { EFFECT_ORDER } from './effect-defs'
import { VariationRng } from './rng'
import type {
  EffectsConfig,
  MaxResolution,
  MediaProbe,
  MetadataConfig,
  QualityPreset,
  RenderConfig,
  ResolvedExport,
  ResolvedVideo,
  VariationManifest,
} from './types'

export const QUALITY_PRESETS: Record<QualityPreset, { crf: number; preset: string; label: string }> = {
  // Speed-first encoder tuning, the same trade the desktop engine makes: a
  // touch of compression efficiency for large throughput gains.
  high: { crf: 19, preset: 'veryfast', label: 'High' },
  balanced: { crf: 23, preset: 'superfast', label: 'Balanced' },
  smaller: { crf: 28, preset: 'ultrafast', label: 'Smaller' },
}

export const RESOLUTION_CAPS: Record<MaxResolution, number | null> = {
  original: null,
  '1080p': 1080,
  '720p': 720,
}

function even(value: number): number {
  return Math.max(2, value - (value % 2))
}

/** Cap the shorter side, keeping the class of the media (§42 — never upscale). */
export function computeCanvas(
  width: number,
  height: number,
  cap: MaxResolution,
): { width: number; height: number } {
  const w = Math.max(2, Math.round(width))
  const h = Math.max(2, Math.round(height))
  const limit = RESOLUTION_CAPS[cap]
  const shorter = Math.min(w, h)
  if (!limit || shorter <= limit) return { width: even(w), height: even(h) }
  const scale = limit / shorter
  return { width: even(Math.round(w * scale)), height: even(Math.round(h * scale)) }
}

export function sanitizeStem(name: string): string {
  const stem = name.replace(/\.[a-z0-9]{1,6}$/i, '')
  const clean = stem.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return clean.slice(0, 60) || 'clip'
}

export function outputNameFor(sourceName: string, variationIndex: number): string {
  return `${sanitizeStem(sourceName)}_v${String(variationIndex + 1).padStart(3, '0')}.mp4`
}

function sampleSetting(
  rng: VariationRng,
  effects: EffectsConfig,
  id: string,
  fallback: number,
): number {
  const setting = effects.settings.find((item) => item.id === id)
  if (!setting || !setting.enabled) return fallback
  return rng.uniform(setting.min, setting.max)
}

/**
 * Sample the whole video plan for one variation. Sample order is fixed so a
 * manifest can be regenerated bit-for-bit from (batchSeed, index, config).
 */
export function resolveVideo(
  rng: VariationRng,
  effects: EffectsConfig,
  probe: MediaProbe,
): ResolvedVideo {
  const duration = probe.durationSeconds
  const speed = sampleSetting(rng, effects, 'speed', 1)
  const cutStart = sampleSetting(rng, effects, 'cutStart', 0)
  const cutEndTrim = sampleSetting(rng, effects, 'cutEnd', 0)
  let cutEnd: number | null = null
  if (duration != null && cutEndTrim > 0) {
    const end = duration - cutEndTrim
    if (end - cutStart > 0.1) cutEnd = end
  }

  const mirrorSetting = effects.settings.find((item) => item.id === 'mirror')
  const mirror = mirrorSetting?.enabled
    ? mirrorSetting.mode ?? (rng.bool() ? ('horizontal' as const) : ('vertical' as const))
    : null

  return {
    brightness: sampleSetting(rng, effects, 'brightness', 0),
    contrast: sampleSetting(rng, effects, 'contrast', 0),
    saturation: sampleSetting(rng, effects, 'saturation', 0),
    hueDegrees: sampleSetting(rng, effects, 'hue', 0),
    temperature: sampleSetting(rng, effects, 'colorTemperature', 0),
    gamma: sampleSetting(rng, effects, 'gamma', 1),
    zoom: sampleSetting(rng, effects, 'zoom', 1),
    shiftXPercent: sampleSetting(rng, effects, 'pixelShiftX', 0),
    shiftYPercent: sampleSetting(rng, effects, 'pixelShiftY', 0),
    rotationDegrees: sampleSetting(rng, effects, 'rotation', 0),
    mirror,
    speed,
    cutStartSeconds: Math.max(0, cutStart),
    cutEndSeconds: cutEnd,
    sharpen: Math.max(0, sampleSetting(rng, effects, 'sharpen', 0)),
    noise: Math.max(0, sampleSetting(rng, effects, 'noise', 0)),
  }
}

export function effectiveDuration(
  manifest: Pick<VariationManifest, 'video'>,
  probe: MediaProbe,
): number | null {
  const duration = probe.durationSeconds
  if (duration == null) return null
  const start = Math.min(Math.max(0, manifest.video.cutStartSeconds), duration)
  const end = Math.min(manifest.video.cutEndSeconds ?? duration, duration)
  const trimmed = Math.max(0.1, end - start)
  return trimmed / Math.min(20, Math.max(0.05, manifest.video.speed))
}

/** True when the video stream can be remuxed instead of decoded and re-encoded. */
export function isNeutralVideo(
  video: ResolvedVideo,
  probe: MediaProbe,
  canvas: { width: number; height: number },
): boolean {
  const sameCanvas = probe.width === canvas.width && probe.height === canvas.height
  return (
    sameCanvas &&
    Math.abs(video.brightness) < 1e-9 &&
    Math.abs(video.contrast) < 1e-9 &&
    Math.abs(video.saturation) < 1e-9 &&
    Math.abs(video.hueDegrees) < 1e-9 &&
    Math.abs(video.temperature) < 1e-9 &&
    Math.abs(video.gamma - 1) < 1e-9 &&
    video.zoom <= 1.0000001 &&
    Math.abs(video.shiftXPercent) < 1e-9 &&
    Math.abs(video.shiftYPercent) < 1e-9 &&
    Math.abs(video.rotationDegrees) < 1e-9 &&
    video.mirror === null &&
    Math.abs(video.speed - 1) < 1e-9 &&
    video.cutStartSeconds <= 0.01 &&
    video.cutEndSeconds == null &&
    video.sharpen <= 0 &&
    video.noise <= 0
  )
}

export type ManifestRequest = {
  batchId: string
  batchSeed: number
  variationIndex: number
  jobId: string
  sourceId: string
  sourceName: string
  probe: MediaProbe
  effects: EffectsConfig
  render: RenderConfig
  metadata: MetadataConfig
}

export function buildManifest(request: ManifestRequest): VariationManifest {
  const rng = new VariationRng(BigInt(request.batchSeed), request.variationIndex)
  const video = resolveVideo(rng, request.effects, request.probe)
  const { width, height } = computeCanvas(
    request.probe.width ?? 1080,
    request.probe.height ?? 1920,
    request.render.maxResolution,
  )
  const quality = QUALITY_PRESETS[request.render.quality]
  const neutral = isNeutralVideo(video, request.probe, { width, height })
  const copyVideo = neutral && request.probe.videoCodec === 'h264'
  const copyAudio =
    Math.abs(video.speed - 1) < 1e-9 && (request.probe.audioCodec === 'aac' || !request.probe.hasAudio)

  const exp: ResolvedExport = {
    outputName: outputNameFor(request.sourceName, request.variationIndex),
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: copyAudio ? 'copy' : 'aac',
    canvasWidth: width,
    canvasHeight: height,
    crf: quality.crf,
    preset: quality.preset,
    audioBitrateKbps: 128,
  }

  return {
    jobId: request.jobId,
    batchId: request.batchId,
    variationIndex: request.variationIndex,
    seed: Number(rng.variationSeed & 0xffffffffffffn),
    sourceId: request.sourceId,
    video,
    metadata: request.metadata,
    export: exp,
    streamCopy: copyVideo && copyAudio,
  }
}

export const EFFECT_IDS = EFFECT_ORDER
