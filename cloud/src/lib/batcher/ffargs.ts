/**
 * The FFmpeg command builder — one decode, one encode, one file written.
 *
 * Ported from the desktop engine's builder (video-batcher src-tauri
 * src/ffmpeg/builder.rs) so both products produce the same picture. Every
 * enabled effect becomes ONE filter in ONE filter graph; there is never a
 * second encode pass for a second effect (§17).
 *
 * The planner's cheapest valid operation (§6) shows up here as `streamCopy`:
 * a manifest whose effects all resolve to neutral values and whose canvas
 * matches the source is a remux — `-c:v copy -c:a copy` — not a re-encode.
 */
import { effectiveDuration } from './manifest'
import type { MediaProbe, VariationManifest } from './types'

function fmt(value: number, decimals: number): string {
  const text = value.toFixed(decimals)
  if (/^-?0*\.?0*$/.test(text)) return (0).toFixed(decimals)
  return text
}

function even(value: number): number {
  return Math.max(2, Math.floor(value) - (Math.floor(value) % 2))
}

/** atempo accepts 0.5..2 per instance, so chain them. */
export function atempoChain(factor: number): string {
  let remaining = Math.min(100, Math.max(0.01, factor))
  const segments: string[] = []
  while (remaining > 2) {
    segments.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.5) {
    segments.push('atempo=0.5')
    remaining /= 0.5
  }
  segments.push(`atempo=${fmt(remaining, 6)}`)
  return segments.join(',')
}

export function buildVideoChain(manifest: VariationManifest): string {
  const video = manifest.video
  const { canvasWidth: width, canvasHeight: height } = manifest.export
  const filters: string[] = []

  filters.push(`scale=${width}:${height}:flags=lanczos`)
  filters.push('setsar=1')

  // ---- color & tone (one eq pass covers three effects + gamma)
  const brightness = video.brightness / 100
  const contrast = 1 + video.contrast / 100
  const saturation = 1 + video.saturation / 100
  if (
    Math.abs(brightness) > Number.EPSILON ||
    Math.abs(contrast - 1) > Number.EPSILON ||
    Math.abs(saturation - 1) > Number.EPSILON ||
    Math.abs(video.gamma - 1) > Number.EPSILON
  ) {
    filters.push(
      `eq=brightness=${fmt(brightness, 6)}:contrast=${fmt(contrast, 6)}:saturation=${fmt(saturation, 6)}:gamma=${fmt(video.gamma, 6)}`,
    )
  }
  if (Math.abs(video.hueDegrees) > Number.EPSILON) {
    filters.push(`hue=h=${fmt(video.hueDegrees, 4)}`)
  }
  if (Math.abs(video.temperature) > Number.EPSILON) {
    // colorchannelmixer is a single fast global pass; colorbalance is ~5x slower.
    const shift = Math.min(0.2, Math.max(-0.2, video.temperature / 10000))
    filters.push(`colorchannelmixer=rr=${fmt(1 + shift, 6)}:gg=1:bb=${fmt(1 - shift, 6)}`)
  }

  // ---- framing & motion: one upscale, rotate, one crop back to canvas
  const shiftX = video.shiftXPercent / 100
  const shiftY = video.shiftYPercent / 100
  const rotation = (video.rotationDegrees * Math.PI) / 180
  const rotationCover =
    Math.abs(rotation) > 1e-6
      ? Math.max(
          (width * Math.cos(rotation) + height * Math.sin(rotation)) / width,
          (width * Math.sin(rotation) + height * Math.cos(rotation)) / height,
        )
      : 1
  const shiftCover = 1 + 2 * Math.max(Math.abs(shiftX), Math.abs(shiftY))
  const zoom = Math.max(video.zoom, 1, rotationCover, shiftCover)

  if (zoom > 1 + 1e-5 || Math.abs(rotation) > 1e-6 || Math.abs(shiftX) > 1e-6 || Math.abs(shiftY) > 1e-6) {
    const zoomWidth = even(width * zoom)
    const zoomHeight = even(height * zoom)
    filters.push(`scale=${Math.max(zoomWidth, width)}:${Math.max(zoomHeight, height)}:flags=fast_bilinear`)
    if (Math.abs(rotation) > 1e-6) {
      filters.push(`rotate=a=${fmt(rotation, 8)}:ow=iw:oh=ih:c=black`)
    }
    const maxX = Math.max(0, Math.max(zoomWidth, width) - width)
    const maxY = Math.max(0, Math.max(zoomHeight, height) - height)
    const offsetX = (maxX) / 2 + shiftX * Math.max(zoomWidth, width)
    const offsetY = (maxY) / 2 + shiftY * Math.max(zoomWidth, width)
    const cropX = Math.round(Math.min(Math.max(0, offsetX), maxX))
    const cropY = Math.round(Math.min(Math.max(0, offsetY), maxY))
    filters.push(`crop=${width}:${height}:${cropX}:${cropY}`)
  }

  if (video.mirror === 'horizontal') filters.push('hflip')
  if (video.mirror === 'vertical') filters.push('vflip')

  // ---- detail & texture
  if (video.sharpen > 0) {
    filters.push(`unsharp=5:5:${fmt(Math.min(2, video.sharpen), 4)}:5:5:0`)
  }
  if (video.noise > 0) {
    filters.push(`noise=alls=${fmt(Math.min(30, video.noise), 2)}:allf=t+u`)
  }

  // ---- timing
  const speed = Math.min(20, Math.max(0.05, video.speed))
  if (Math.abs(speed - 1) > 1e-6) {
    filters.push(`setpts=PTS/${fmt(speed, 6)}`)
  }

  filters.push('format=yuv420p')
  return filters.join(',')
}

export function buildOriginalAudioChain(manifest: VariationManifest): string | null {
  const speed = Math.min(20, Math.max(0.05, manifest.video.speed))
  if (Math.abs(speed - 1) > 1e-6) return atempoChain(speed)
  return null
}

export type BuildArgsOptions = {
  /** Mount path of the source inside the worker FS, e.g. /in/clip.mp4 */
  inputPath: string
  /** Multithreaded core only: thread budget for decode + filters + encoder. */
  threads: number
  multithreaded: boolean
}

export function buildFfmpegArgs(
  manifest: VariationManifest,
  probe: MediaProbe,
  options: BuildArgsOptions,
): string[] {
  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-nostats',
  ]

  if (manifest.video.cutStartSeconds > 0.01) {
    args.push('-ss', fmt(manifest.video.cutStartSeconds, 6))
  }
  args.push('-i', options.inputPath)

  const outDuration = effectiveDuration(manifest, probe)

  if (manifest.streamCopy) {
    args.push('-map', '0:v:0', '-map', '0:a?', '-c:v', 'copy', '-c:a', 'copy')
  } else {
    const videoChain = buildVideoChain(manifest)
    const graph: string[] = [`[0:v]${videoChain}[vout]`]
    const hasAudio = probe.hasAudio
    const audioChain = hasAudio ? buildOriginalAudioChain(manifest) : null
    const audioCopy = hasAudio && manifest.export.audioCodec === 'copy'

    if (hasAudio && !audioCopy) {
      graph.push(`[0:a]${audioChain ?? 'anull'}[aout]`)
    }
    args.push('-filter_complex', graph.join(';'))
    args.push('-map', '[vout]')

    if (!hasAudio) {
      args.push('-an')
    } else if (audioCopy) {
      args.push('-map', '0:a?', '-c:a', 'copy')
    } else {
      args.push('-map', '[aout]')
    }

    args.push('-c:v', 'libx264', '-preset', manifest.export.preset)
    args.push('-crf', String(manifest.export.crf))
    args.push('-profile:v', 'high', '-pix_fmt', 'yuv420p')

    if (hasAudio && !audioCopy) {
      args.push('-c:a', 'aac', '-b:a', `${manifest.export.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2')
    }
  }

  args.push('-movflags', '+faststart')

  // Metadata: keep the container's own tags, but strip location keys when the
  // user asked for privacy, and tag the variation for provenance (§22). The
  // tag is organization data for a batch — never falsified device metadata.
  args.push('-map_metadata', '0')
  if (manifest.metadata.stripGps) {
    args.push('-metadata', 'location=', '-metadata', 'location-eng=')
  }
  if (manifest.metadata.variationTag) {
    args.push(
      '-metadata',
      `description=Video Batcher variation=${manifest.variationIndex + 1} seed=${manifest.seed} batch=${manifest.batchId}`,
    )
  }
  if (manifest.metadata.title.trim()) args.push('-metadata', `title=${manifest.metadata.title.trim()}`)
  if (manifest.metadata.comment.trim()) args.push('-metadata', `comment=${manifest.metadata.comment.trim()}`)

  if (outDuration != null) args.push('-t', fmt(outDuration, 6))

  if (options.multithreaded) {
    const threads = Math.max(1, Math.min(8, options.threads))
    args.push('-threads', String(threads))
    args.push('-filter_complex_threads', String(threads))
  }

  args.push(manifest.export.outputName)
  return args
}
