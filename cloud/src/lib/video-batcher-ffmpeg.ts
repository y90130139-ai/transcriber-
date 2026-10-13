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
import { createSeededRandom, type ConvertTarget, type ConverterSettings, type MetadataSettings } from '@/lib/video-batcher'
import type { MediaKind } from '@/lib/video-batcher-browser'

const FFMPEG_CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

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
}

export interface ExportPassResult {
  blob: Blob
  mimeType: string
  extension: string
  warnings: string[]
}

export interface ExportPassHooks {
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

async function loadFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')])
      const ffmpeg = new FFmpeg()
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      coreLoaded = true
      return ffmpeg
    })().catch((error) => {
      ffmpegPromise = null
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
export async function runExportPass(
  input: ExportPassInput,
  metadata: MetadataSettings,
  converter: ConverterSettings,
  context: ExportPassContext,
  hooks: ExportPassHooks = {},
): Promise<ExportPassResult> {
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
    return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings }
  }

  if (spec && input.kind === 'image') {
    if (spec.audioOnly) {
      warnings.push('Audio conversion needs a video source — this output kept its still-image form.')
      return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings }
    }
    if (!spec.still && converter.target !== 'gif') {
      warnings.push('Video conversion needs a video source — this output kept its still-image form.')
      return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings }
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
    warnings.push(`The on-device converter could not start, so this output kept its rendered form. (${error instanceof Error ? error.message : 'unknown error'})`)
    return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings }
  }

  hooks.onPhase?.(converting ? 'Converting on-device…' : 'Writing metadata on-device…')

  const inName = `input.${input.extension || 'bin'}`
  const outExtension = spec ? spec.extension : input.extension
  const outName = `output.${outExtension}`
  const outMimeType = spec ? spec.mimeType : input.mimeType

  try {
    const { fetchFile } = await import('@ffmpeg/util')
    await ffmpeg.writeFile(inName, await fetchFile(input.blob))

    const jitter = metadata.encoderParams ? createSeededRandom(context.seed ^ 0x51ed270b)() * 4 - 2 : 0
    const conversionArgs = spec ? spec.args(crfForQuality(converter.quality, jitter)) : ['-c', 'copy']
    const stripEverything = metadata.gps || metadata.sourceTags || metadata.cleanExport

    const args = ['-i', inName]
    if (stripEverything) args.push('-map_metadata', '-1')
    args.push(...buildMetadataArgs(metadata, context), ...conversionArgs, outName)

    const progressHandler = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) hooks.onProgress?.(Math.max(0, Math.min(1, progress)))
    }
    ffmpeg.on('progress', progressHandler)
    let exitCode = -1
    try {
      exitCode = await ffmpeg.exec(args)
    } finally {
      ffmpeg.off('progress', progressHandler)
    }
    if (exitCode !== 0) throw new Error(`The converter exited with code ${exitCode}.`)

    const data = await ffmpeg.readFile(outName)
    if (typeof data === 'string') throw new Error('The converter returned an unexpected result.')
    const bytes = new Uint8Array(data.byteLength)
    bytes.set(data)
    const blob = new Blob([bytes.buffer], { type: outMimeType })
    if (!blob.size) throw new Error('The converter produced an empty file.')
    return { blob, mimeType: outMimeType, extension: outExtension, warnings }
  } catch (error) {
    warnings.push(`The on-device ${converting ? 'conversion' : 'metadata pass'} did not finish, so this output kept its rendered form. (${error instanceof Error ? error.message : 'unknown error'})`)
    return { blob: input.blob, mimeType: input.mimeType, extension: input.extension, warnings }
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {})
    await ffmpeg.deleteFile(outName).catch(() => {})
  }
}
