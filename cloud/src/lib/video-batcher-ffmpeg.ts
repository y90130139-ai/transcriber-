/**
 * The on-device export pass (Geno, 2026-10-12): after the canvas recorder
 * finishes an output, this runs it through ffmpeg compiled to WebAssembly —
 * entirely inside the browser. Two jobs:
 *
 *  - metadata: writes the enabled randomized fields into the finished file
 *    (description, title, comment, creation time, encoder tag) and strips
 *    everything else when the privacy flags ask for it. Stream copy, fast.
 *  - converter & compressor: rebuilds the output into any listed format
 *    (MP4/WebM/MKV/MOV/GIF/MP3/M4A/WAV/JPG/PNG/WebP) with a quality lever
 *    that maps to CRF. Re-encode, slower.
 *
 * The ffmpeg core (~31 MB) is fetched once from the CDN on first use and
 * cached by the browser. Media bytes never leave the device: files are
 * written into ffmpeg's in-memory filesystem, processed, and read back.
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { createSeededRandom, type ConvertTarget, type ConverterSettings, type MetadataSettings } from './video-batcher'
import type { MediaKind } from '@/lib/video-batcher-browser'

// Keep this in lockstep with @ffmpeg/ffmpeg's CORE_VERSION (0.12.9).
// The 0.12.6 core protocol is not compatible with the installed 0.12.15 wrapper.
const FFMPEG_CORE_VERSION = '0.12.9'
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`

export interface ExportPassContext {
  seed: number
  batchSeed: number
  variationIndex: number
  variationCount: number
}

export interface ExportPassInput {
  blob: Blob
  extension: string
  mimeType: string
  kind: MediaKind
  durationSeconds?: number | null
}

export interface ExportPassResult {
  blob: Blob
  mimeType: string
  extension: string
  warnings: string[]
  /** True when a requested metadata/conversion action had to be skipped. */
  fallback: boolean
}

export interface ExportPassHooks {
  signal?: AbortSignal
  onPhase?: (phase: string) => void
  onProgress?: (progress: number) => void
}

interface TargetSpec {
  extension: string
  mimeType: string
  audioOnly: boolean
  still: boolean
  args: (crf: number) => string[]
}

const TARGET_SPECS: Record<Exclude<ConvertTarget, 'keep'>, TargetSpec> = {
  mp4: {
    extension: 'mp4',
    mimeType: 'video/mp4',
    audioOnly: false,
    still: false,
    args: (crf) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
  },
  webm: {
    extension: 'webm',
    mimeType: 'video/webm',
    audioOnly: false,
    still: false,
    args: (crf) => ['-c:v', 'libvpx', '-b:v', '0', '-crf', String(crf), '-c:a', 'libopus', '-b:a', '96k'],
  },
  mkv: {
    extension: 'mkv',
    mimeType: 'video/x-matroska',
    audioOnly: false,
    still: false,
    args: (crf) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'],
  },
  mov: {
    extension: 'mov',
    mimeType: 'video/quicktime',
    audioOnly: false,
    still: false,
    args: (crf) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
  },
  gif: {
    extension: 'gif',
    mimeType: 'image/gif',
    audioOnly: false,
    still: false,
    args: () => ['-vf', 'fps=12,scale=480:-2:flags=lanczos', '-loop', '0', '-an'],
  },
  mp3: {
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    audioOnly: true,
    still: false,
    args: () => ['-vn', '-c:a', 'libmp3lame', '-q:a', '4'],
  },
  m4a: {
    extension: 'm4a',
    mimeType: 'audio/mp4',
    audioOnly: true,
    still: false,
    args: () => ['-vn', '-c:a', 'aac', '-b:a', '160k'],
  },
  wav: {
    extension: 'wav',
    mimeType: 'audio/wav',
    audioOnly: true,
    still: false,
    args: () => ['-vn', '-c:a', 'pcm_s16le'],
  },
  jpg: {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    audioOnly: false,
    still: true,
    args: (crf) => ['-frames:v', '1', '-q:v', String(Math.max(2, Math.min(31, Math.round(2 + (38 - crf) * 0.8))))],
  },
  png: {
    extension: 'png',
    mimeType: 'image/png',
    audioOnly: false,
    still: true,
    args: () => ['-frames:v', '1'],
  },
  webp: {
    extension: 'webp',
    mimeType: 'image/webp',
    audioOnly: false,
    still: true,
    args: () => ['-frames:v', '1', '-q:v', '80'],
  },
}

let ffmpegPromise: Promise<FFmpeg> | null = null
let coreLoaded = false
let operationsSinceReset = 0
const MAX_PASSES_PER_WORKER = 8
let exportPassQueue: Promise<void> = Promise.resolve()

function resetFfmpeg(ffmpeg?: FFmpeg): void {
  try {
    ffmpeg?.terminate()
  } catch {
    // A worker that has already crashed may reject termination.
  }
  ffmpegPromise = null
  coreLoaded = false
  operationsSinceReset = 0
}

function errorDetail(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown; toString?: () => string }
    if (typeof candidate.message === 'string') {
      return `${typeof candidate.name === 'string' ? `${candidate.name}: ` : ''}${candidate.message}`
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(candidate.toString?.() ?? 'Unknown FFmpeg worker error')
    }
  }
  return error == null ? 'The FFmpeg worker returned no error details.' : String(error)
}

function printableLogs(logs: string[]): string {
  return logs.slice(-5).join(' | ').replace(/\s+/g, ' ').slice(0, 600)
}

async function loadFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')])
      const ffmpeg = new FFmpeg()
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        coreLoaded = true
        return ffmpeg
      } catch (error) {
        resetFfmpeg(ffmpeg)
        throw error
      }
    })().catch((error) => {
      resetFfmpeg()
      throw error
    })
  }
  return ffmpegPromise
}

/** True when a metadata pass would write (or strip) anything. */
export function metadataPassActive(metadata: MetadataSettings): boolean {
  return metadata.variationTag || metadata.creationTime || metadata.comments || metadata.title
    || (metadata.encoderTagEnabled && metadata.encoderTag.trim().length > 0)
    || metadata.gps || metadata.sourceTags || metadata.cleanExport
}

/** True when the converter would rebuild the file into another format/quality. */
export function converterPassActive(converter: ConverterSettings): boolean {
  return converter.target !== 'keep' || converter.quality < 100
}

export function exportPassActive(metadata: MetadataSettings, converter: ConverterSettings): boolean {
  return metadataPassActive(metadata) || converterPassActive(converter)
}

/** Deterministic from the variation seed, so the same batch tags the same way. */
export function variationToken(seed: number, batchSeed: number, variationIndex: number): string {
  const seedHex = (seed >>> 0).toString(16).padStart(8, '0')
  const batchHex = (batchSeed >>> 0).toString(16).padStart(8, '0')
  return `VB-${batchHex.slice(0, 4).toUpperCase()}-${seedHex.slice(0, 6).toUpperCase()}-V${String(variationIndex + 1).padStart(2, '0')}`
}

export function deterministicCreationTime(seed: number): string {
  const dayMs = 86_400_000
  const base = Date.UTC(2026, 0, 1)
  const offset = (seed >>> 0) % (240 * dayMs)
  return new Date(base + offset).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function crfForQuality(quality: number, jitter: number): number {
  const base = 40 - (quality / 100) * 22
  return Math.max(14, Math.min(38, Math.round(base + jitter)))
}

function buildMetadataArgs(metadata: MetadataSettings, context: ExportPassContext): string[] {
  const args: string[] = []
  const token = variationToken(context.seed, context.batchSeed, context.variationIndex)
  if (metadata.variationTag) {
    args.push('-metadata', `description=${token} · variation ${context.variationIndex + 1} of ${context.variationCount}`)
  }
  if (metadata.title) args.push('-metadata', `title=Clip ${token.split('-').slice(1).join('-')}`)
  if (metadata.comments) {
    args.push('-metadata', `comment=Local render · variation ${context.variationIndex + 1} of ${context.variationCount} · seed ${(context.seed >>> 0).toString(16).padStart(8, '0')}`)
  }
  if (metadata.creationTime) args.push('-metadata', `creation_time=${deterministicCreationTime(context.seed)}`)
  if (metadata.encoderTagEnabled && metadata.encoderTag.trim()) args.push('-metadata', `encoder=${metadata.encoderTag.trim()}`)
  return args
}

function specForContainer(extension: string): TargetSpec | null {
  const mapping: Record<string, Exclude<ConvertTarget, 'keep'>> = {
    mp4: 'mp4', m4v: 'mp4', webm: 'webm', mkv: 'mkv', mov: 'mov', gif: 'gif',
    jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp',
  }
  const target = mapping[extension.replace(/^\./, '').toLowerCase()]
  return target ? TARGET_SPECS[target] : null
}

/** Runs the on-device pass. Any failure degrades to a warning: the rendered
 *  output is returned untouched rather than losing the job. */
export function runExportPass(
  input: ExportPassInput,
  metadata: MetadataSettings,
  converter: ConverterSettings,
  context: ExportPassContext,
  hooks: ExportPassHooks = {},
): Promise<ExportPassResult> {
  const result = exportPassQueue.then(() => runExportPassExclusive(input, metadata, converter, context, hooks))
  exportPassQueue = result.then(() => undefined, () => undefined)
  return result
}

async function runExportPassExclusive(
  input: ExportPassInput,
  metadata: MetadataSettings,
  converter: ConverterSettings,
  context: ExportPassContext,
  hooks: ExportPassHooks,
): Promise<ExportPassResult> {
  if (hooks.signal?.aborted) throw new DOMException('The export pass was cancelled.', 'AbortError')
  const warnings: string[] = []
  const wantsQuality = converter.target === 'keep' && converter.quality < 100
  const spec = converter.target !== 'keep'
    ? TARGET_SPECS[converter.target]
    : wantsQuality
      ? specForContainer(input.extension)
      : null
  const converting = spec !== null
  if (wantsQuality && !spec) {
    warnings.push('This output format cannot be re-encoded on-device, so the compression level was skipped and the file kept its encoded form.')
  }
  if (!converting && !metadataPassActive(metadata)) {
    return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings, fallback: warnings.length > 0 }
  }

  if (spec && input.kind === 'image') {
    if (spec.audioOnly) {
      warnings.push('Audio conversion needs a video source — this output kept its still-image form.')
      return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings, fallback: true }
    }
    if (!spec.still && converter.target !== 'gif') {
      warnings.push('Video conversion needs a video source — this output kept its still-image form.')
      return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings, fallback: true }
    }
  }
  if (spec && spec.audioOnly && input.kind === 'video') {
    warnings.push('Audio-only export — the video track is dropped.')
  }

  let ffmpeg: FFmpeg
  try {
    if (!coreLoaded) hooks.onPhase?.('Loading the on-device converter (first run ~31 MB, then cached)…')
    ffmpeg = await loadFfmpeg()
  } catch (error) {
    if (hooks.signal?.aborted) throw new DOMException('The export pass was cancelled.', 'AbortError')
    warnings.push(`The on-device converter could not start, so this output kept its rendered form. (${errorDetail(error)})`)
    return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings, fallback: true }
  }

  hooks.onPhase?.(converting ? 'Converting on-device…' : 'Writing metadata on-device…')

  const passTag = `${(context.batchSeed >>> 0).toString(36)}-${(context.seed >>> 0).toString(36)}-${context.variationIndex.toString(36)}`
  const inputExtension = input.extension.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const inName = `input-${passTag}.${inputExtension}`
  const outExtension = spec ? spec.extension : input.extension
  const outName = `output-${passTag}.${outExtension}`
  const outMimeType = spec ? spec.mimeType : input.mimeType
  const logs: string[] = []
  const onLog = ({ type, message }: { type: string; message: string }) => {
    logs.push(`${type}: ${message}`)
    if (logs.length > 20) logs.shift()
  }
  ffmpeg.on('log', onLog)

  try {
    const { fetchFile } = await import('@ffmpeg/util')
    const written = await ffmpeg.writeFile(inName, await fetchFile(input.blob), { signal: hooks.signal })
    if (!written) throw new Error(`FFmpeg could not write ${inputExtension} input bytes.`)

    const jitter = metadata.encoderParams ? createSeededRandom(context.seed ^ 0x51ed270b)() * 4 - 2 : 0
    const imageToGif = converter.target === 'gif' && input.kind === 'image'
    const conversionArgs = spec
      ? imageToGif
        ? ['-frames:v', '1', '-loop', '0', '-an']
        : spec.args(crfForQuality(converter.quality, jitter))
      : ['-c', 'copy']
    const stripEverything = metadata.gps || metadata.sourceTags || metadata.cleanExport

    const args = ['-hide_banner', '-loglevel', 'error', '-i', inName]
    if (stripEverything) args.push('-map_metadata', '-1')
    args.push(...buildMetadataArgs(metadata, context), ...conversionArgs, outName)

    const progressHandler = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) hooks.onProgress?.(Math.max(0, Math.min(1, progress)))
    }
    ffmpeg.on('progress', progressHandler)
    let exitCode = -1
    const durationSeconds = Math.max(0, input.durationSeconds ?? 0)
    const timeoutMs = spec
      ? Math.min(600_000, Math.max(120_000, durationSeconds * 30_000))
      : 60_000
    try {
      exitCode = await ffmpeg.exec(args, timeoutMs, { signal: hooks.signal })
    } finally {
      ffmpeg.off('progress', progressHandler)
    }
    if (exitCode !== 0) {
      const logsText = printableLogs(logs)
      throw new Error(`FFmpeg exited with code ${exitCode}.${logsText ? ` ${logsText}` : ''}`)
    }

    const data = await ffmpeg.readFile(outName, 'binary', { signal: hooks.signal })
    if (typeof data === 'string') throw new Error('The converter returned an unexpected result.')
    const bytes = new Uint8Array(data.byteLength)
    bytes.set(data)
    const blob = new Blob([bytes.buffer], { type: outMimeType })
    if (!blob.size) throw new Error('The converter produced an empty file.')
    if (!hasExpectedSignature(bytes, outExtension)) {
      throw new Error(`The converted bytes do not match the expected ${outExtension.toUpperCase()} container.`)
    }
    return { blob, mimeType: outMimeType, extension: outExtension, warnings, fallback: false }
  } catch (error) {
    if (hooks.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      resetFfmpeg(ffmpeg)
      throw new DOMException('The export pass was cancelled.', 'AbortError')
    }
    const detail = errorDetail(error)
    const logsText = printableLogs(logs)
    const contextText = logsText ? ` FFmpeg log: ${logsText}` : ''
    warnings.push(`The on-device ${converting ? 'conversion' : 'metadata pass'} did not finish, so this output kept its rendered form. (${detail})${contextText}`)
    // A failed command may leave the in-memory filesystem or worker state
    // inconsistent. The next variation gets a clean worker instead of a
    // cascade of repeated opaque failures.
    resetFfmpeg(ffmpeg)
    return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings, fallback: true }
  } finally {
    ffmpeg.off('log', onLog)
    if (ffmpeg.loaded) {
      await ffmpeg.deleteFile(inName).catch(() => {})
      await ffmpeg.deleteFile(outName).catch(() => {})
      operationsSinceReset += 1
      if (operationsSinceReset >= MAX_PASSES_PER_WORKER) resetFfmpeg(ffmpeg)
    }
  }
}

/** Verify that ffmpeg returned the requested container, rather than trusting
 *  a Blob MIME label that we assigned ourselves. */
export function hasExpectedSignature(bytes: Uint8Array, extension: string): boolean {
  const ext = extension.replace(/^\./, '').toLowerCase()
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)))
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  const text = ascii(0, Math.min(bytes.length, 512)).toLowerCase()

  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return starts(0xff, 0xd8, 0xff)
    case 'png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    case 'gif':
      return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a'
    case 'wav':
      return (ascii(0, 4) === 'RIFF' || ascii(0, 4) === 'RF64') && ascii(8, 12) === 'WAVE'
    case 'mp3': {
      if (ascii(0, 3) === 'ID3') return true
      for (let index = 0; index < Math.min(bytes.length - 1, 4096); index += 1) {
        if (bytes[index] === 0xff && (bytes[index + 1] & 0xe0) === 0xe0) return true
      }
      return false
    }
    case 'mp4':
    case 'm4a':
    case 'mov': {
      if (ascii(4, 8) !== 'ftyp') return false
      const brand = ascii(8, 12)
      if (ext === 'mov') return brand === 'qt  '
      if (ext === 'm4a') return ['M4A ', 'M4B ', 'mp42', 'isom'].includes(brand)
      return ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand)
    }
    case 'webm':
      return starts(0x1a, 0x45, 0xdf, 0xa3) && text.includes('webm')
    case 'mkv':
      return starts(0x1a, 0x45, 0xdf, 0xa3) && text.includes('matroska')
    default:
      return bytes.length > 0
  }
}
