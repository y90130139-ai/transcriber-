import {
  computeOutputSize,
  resolveTrim,
  type AspectRatio,
  type ResolutionCap,
  type ResolvedVariation,
} from './video-batcher'

export type MediaKind = 'video' | 'image'

export interface LocalMedia {
  id: string
  file: File
  url: string
  kind: MediaKind
  width: number
  height: number
  duration: number | null
  thumbnail: string | null
  inspectionError: string | null
}

export interface BrowserMediaCapabilities {
  canRecordVideo: boolean
  canCaptureCanvas: boolean
  videoMimeTypes: string[]
  imageMimeTypes: string[]
  hardwareConcurrency: number
  webGpuAvailable: boolean
}

export interface CaptionRenderSettings {
  text: string
  size: number
  color: string
  x: number
  y: number
}

export interface WatermarkRenderSettings {
  text: string
  imageUrl: string | null
  opacity: number
  scale: number
  x: number
  y: number
}

export interface AudioRenderSettings {
  muted: boolean
  volumeDb: number
  fadeIn: number
  fadeOut: number
  eqLow: number
  eqMid: number
  eqHigh: number
}

export interface BrowserRenderOptions {
  variation: ResolvedVariation
  aspectRatio: AspectRatio
  resolution: ResolutionCap
  videoMime: 'auto' | 'video/webm' | 'video/mp4'
  imageMime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'
  imageQuality: number
  videoBitrateMbps: number
  flipHorizontal: boolean
  flipVertical: boolean
  caption: CaptionRenderSettings
  watermark: WatermarkRenderSettings
  audio: AudioRenderSettings
  signal: AbortSignal
  isPaused: () => boolean
  onProgress: (progress: number) => void
}

export interface RenderedMedia {
  blob: Blob
  mimeType: string
  extension: string
  durationSeconds: number | null
  width: number
  height: number
  warnings: string[]
}

const VIDEO_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
]
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const

export function detectBrowserMediaCapabilities(): BrowserMediaCapabilities {
  const videoMimeTypes = typeof MediaRecorder === 'undefined'
    ? []
    : VIDEO_MIMES.filter((mime) => MediaRecorder.isTypeSupported(mime))
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
  const imageMimeTypes = canvas
    ? IMAGE_MIMES.filter((mime) => canvas.toDataURL(mime).startsWith(`data:${mime}`))
    : []
  return {
    canRecordVideo: typeof MediaRecorder !== 'undefined' && videoMimeTypes.length > 0,
    canCaptureCanvas: Boolean(canvas && 'captureStream' in canvas),
    videoMimeTypes,
    imageMimeTypes,
    hardwareConcurrency: typeof navigator === 'undefined' ? 2 : Math.max(1, navigator.hardwareConcurrency || 2),
    webGpuAvailable: typeof navigator !== 'undefined' && 'gpu' in navigator,
  }
}

export async function inspectLocalMedia(file: File, id: string): Promise<LocalMedia> {
  const url = URL.createObjectURL(file)
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const kind: MediaKind | null = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'].includes(extension)
    ? 'image'
    : file.type.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ogv'].includes(extension)
      ? 'video'
      : null
  if (!kind) {
    URL.revokeObjectURL(url)
    throw new Error('Choose a video or image file supported by this browser.')
  }

  try {
    if (kind === 'image') {
      const image = await loadImage(url)
      return {
        id, file, url, kind,
        width: image.naturalWidth,
        height: image.naturalHeight,
        duration: null,
        thumbnail: makeThumbnail(image),
        inspectionError: null,
      }
    }

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url
    await waitForMediaMetadata(video)
    const duration = await readFiniteDuration(video)
    let thumbnail: string | null = null
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      try {
        if (video.duration > 0.1) {
          video.currentTime = Math.min(0.1, video.duration / 3)
          await waitForSeek(video)
        }
        thumbnail = makeThumbnail(video)
      } catch {
        thumbnail = null
      }
    }
    const width = video.videoWidth
    const height = video.videoHeight
    video.removeAttribute('src')
    video.load()
    return {
      id, file, url, kind,
      width,
      height,
      duration,
      thumbnail,
      inspectionError: width > 0 ? null : 'This browser could not read the video dimensions.',
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw new Error(error instanceof Error ? error.message : 'The media file could not be inspected.')
  }
}

export async function renderImage(media: LocalMedia, options: BrowserRenderOptions): Promise<RenderedMedia> {
  if (options.signal.aborted) throw abortError()
  const image = await loadImage(media.url)
  const watermarkImage = await loadWatermark(options.watermark.imageUrl)
  const size = computeOutputSize(image.naturalWidth, image.naturalHeight, options.aspectRatio, options.resolution, false)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { alpha: options.imageMime === 'image/png' })
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.')

  drawFrame(context, image, image.naturalWidth, image.naturalHeight, size.width, size.height, size.crop, options, watermarkImage)
  if (options.signal.aborted) throw abortError()
  const blob = await canvasToBlob(canvas, options.imageMime, options.imageQuality)
  if (!blob.size) throw new Error('The browser returned an empty image output.')
  const actualMime = blob.type || options.imageMime
  options.onProgress(1)
  return {
    blob,
    mimeType: actualMime,
    extension: extensionForMime(actualMime),
    durationSeconds: null,
    width: canvas.width,
    height: canvas.height,
    warnings: [],
  }
}

export async function renderVideo(media: LocalMedia, options: BrowserRenderOptions): Promise<RenderedMedia> {
  const capabilities = detectBrowserMediaCapabilities()
  if (!capabilities.canCaptureCanvas || !capabilities.canRecordVideo) {
    throw new Error('This browser cannot record processed canvas video. Try a current version of Chrome, Edge, Firefox, or Safari.')
  }
  if (options.signal.aborted) throw abortError()

  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.src = media.url
  await waitForMediaMetadata(video)
  if (!video.videoWidth || !video.videoHeight) throw new Error('The browser decoded the file but did not expose a usable video stream.')
  const sourceDuration = await readFiniteDuration(video)
  if (!sourceDuration) throw new Error('The browser could not determine the video duration.')

  const effect = options.variation.effects
  const watermarkImage = await loadWatermark(options.watermark.imageUrl)
  const trim = resolveTrim(sourceDuration, effect.trimStart, effect.trimEnd)
  const outputDuration = (trim.end - trim.start) / effect.speed
  const size = computeOutputSize(video.videoWidth, video.videoHeight, options.aspectRatio, options.resolution, true)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.')

  const warnings: string[] = []
  const canvasStream = canvas.captureStream(30)
  const stream = new MediaStream(canvasStream.getVideoTracks())
  let audioContext: AudioContext | null = null
  let recorder: MediaRecorder | null = null
  let resolveRecording: ((blob: Blob) => void) | null = null
  let rejectRecording: ((error: Error) => void) | null = null
  let recording: Promise<Blob> | null = null
  const chunks: Blob[] = []

  try {
    if (!options.audio.muted) {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextConstructor) {
        try {
          audioContext = new AudioContextConstructor()
          await audioContext.resume()
          const source = audioContext.createMediaElementSource(video)
          const low = audioContext.createBiquadFilter()
          low.type = 'lowshelf'
          low.frequency.value = 120
          low.gain.value = options.audio.eqLow
          const mid = audioContext.createBiquadFilter()
          mid.type = 'peaking'
          mid.frequency.value = 1000
          mid.Q.value = 0.9
          mid.gain.value = options.audio.eqMid
          const high = audioContext.createBiquadFilter()
          high.type = 'highshelf'
          high.frequency.value = 8000
          high.gain.value = options.audio.eqHigh
          const gain = audioContext.createGain()
          gain.gain.value = 10 ** (options.audio.volumeDb / 20)
          const destination = audioContext.createMediaStreamDestination()
          source.connect(low).connect(mid).connect(high).connect(gain).connect(destination)
          for (const track of destination.stream.getAudioTracks()) stream.addTrack(track)

          let lastFadeBucket = -1
          const updateGain = () => {
            const elapsed = Math.max(0, (video.currentTime - trim.start) / effect.speed)
            const fadeInGain = options.audio.fadeIn > 0 ? Math.min(1, elapsed / options.audio.fadeIn) : 1
            const remaining = Math.max(0, outputDuration - elapsed)
            const fadeOutGain = options.audio.fadeOut > 0 ? Math.min(1, remaining / options.audio.fadeOut) : 1
            const bucket = Math.floor(elapsed * 10)
            if (bucket !== lastFadeBucket) {
              gain.gain.setTargetAtTime((10 ** (options.audio.volumeDb / 20)) * fadeInGain * fadeOutGain, audioContext!.currentTime, 0.035)
              lastFadeBucket = bucket
            }
          }
          video.addEventListener('timeupdate', updateGain)
          video.addEventListener('seeked', updateGain)
        } catch (error) {
          if (audioContext) await audioContext.close().catch(() => undefined)
          audioContext = null
          const hasAudioEdits = options.audio.volumeDb !== 0 || options.audio.fadeIn > 0 || options.audio.fadeOut > 0 || options.audio.eqLow !== 0 || options.audio.eqMid !== 0 || options.audio.eqHigh !== 0
          if (hasAudioEdits) throw new Error('Audio effects need the browser Web Audio API, which failed to initialize for this file.')
          const capture = getVideoCaptureStream(video)
          const rawAudio = capture?.getAudioTracks() ?? []
          if (rawAudio.length) {
            rawAudio.forEach((track) => stream.addTrack(track))
            warnings.push('Audio was passed through without Web Audio processing.')
          } else {
            warnings.push('The browser could not expose an audio track; this output will be video-only.')
          }
          void error
        }
      } else {
        const hasAudioEdits = options.audio.volumeDb !== 0 || options.audio.fadeIn > 0 || options.audio.fadeOut > 0 || options.audio.eqLow !== 0 || options.audio.eqMid !== 0 || options.audio.eqHigh !== 0
        if (hasAudioEdits) throw new Error('Audio effects are unavailable because this browser has no Web Audio API.')
        const capture = getVideoCaptureStream(video)
        const rawAudio = capture?.getAudioTracks() ?? []
        rawAudio.forEach((track) => stream.addTrack(track))
        if (!rawAudio.length) warnings.push('The browser could not expose an audio track; this output will be video-only.')
      }
    }

    const selectedMime = selectVideoMime(options.videoMime, capabilities.videoMimeTypes)
    if (!selectedMime) throw new Error(`The selected ${options.videoMime === 'video/mp4' ? 'MP4' : 'WebM'} video format is not supported by this browser.`)
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: Math.round(options.videoBitrateMbps * 1_000_000),
      })
    } catch {
      throw new Error(`The browser rejected ${selectedMime}; choose Automatic format or another supported format.`)
    }

    recording = new Promise<Blob>((resolve, reject) => {
      resolveRecording = resolve
      rejectRecording = reject
    })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => rejectRecording?.(new Error('The browser media recorder stopped unexpectedly.'))
    recorder.onstop = () => {
      const output = new Blob(chunks, { type: recorder?.mimeType || selectedMime })
      if (output.size) resolveRecording?.(output)
      else rejectRecording?.(new Error('The browser produced an empty video output.'))
    }

    video.playbackRate = effect.speed
    if ('preservesPitch' in video) video.preservesPitch = true
    video.currentTime = trim.start
    await waitForSeek(video)
    drawFrame(context, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height, size.crop, options, watermarkImage)
    recorder.start(1000)
    await video.play()

    while (video.currentTime < trim.end && !options.signal.aborted) {
      if (options.isPaused()) {
        video.pause()
        if (recorder.state === 'recording') recorder.pause()
        while (options.isPaused() && !options.signal.aborted) await nextFrame()
        if (options.signal.aborted) break
        if (recorder.state === 'paused') recorder.resume()
        await video.play()
      }
      if (options.signal.aborted) break
      await nextVideoFrame(video)
      if (options.signal.aborted || video.currentTime >= trim.end) break
      drawFrame(context, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height, size.crop, options, watermarkImage)
      options.onProgress(Math.min(0.99, (video.currentTime - trim.start) / (trim.end - trim.start)))
    }
    if (options.signal.aborted) throw abortError()

    video.pause()
    drawFrame(context, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height, size.crop, options, watermarkImage)
    options.onProgress(1)
    recorder.stop()
    const blob = await recording
    const mimeType = blob.type || selectedMime.split(';')[0]
    return {
      blob,
      mimeType,
      extension: extensionForMime(mimeType),
      durationSeconds: outputDuration,
      width: canvas.width,
      height: canvas.height,
      warnings,
    }
  } catch (error) {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (recording) await recording.catch(() => undefined)
    throw error
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    stream.getTracks().forEach((track) => track.stop())
    canvasStream.getTracks().forEach((track) => track.stop())
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => undefined)
  }
}

/** Convert an already-rendered video frame to a still in the browser. Keeping
 *  still-image targets on Canvas avoids a second lossy FFmpeg encode and also
 *  preserves the video render's effects, captions and watermark. */
export async function extractVideoFrame(
  blob: Blob,
  mime: 'image/jpeg' | 'image/png' | 'image/webp',
  quality: number,
): Promise<RenderedMedia> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = url
  try {
    await waitForMediaMetadata(video)
    if (!video.videoWidth || !video.videoHeight) throw new Error('The rendered video has no frame to export.')
    const duration = await readFiniteDuration(video)
    if (duration && duration > 0.1) {
      video.currentTime = Math.min(0.1, duration / 3)
      await waitForSeek(video)
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { alpha: mime === 'image/png' })
    if (!context) throw new Error('Canvas rendering is unavailable in this browser.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const output = await canvasToBlob(canvas, mime, quality)
    if (!output.size) throw new Error('The browser returned an empty still frame.')
    const actualMime = output.type || mime
    return {
      blob: output,
      mimeType: actualMime,
      extension: extensionForMime(actualMime),
      durationSeconds: null,
      width: canvas.width,
      height: canvas.height,
      warnings: [],
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function verifyRenderedMedia(blob: Blob, kind: MediaKind): Promise<{ width: number; height: number; duration: number | null }> {
  if (!blob.size) throw new Error('The output is empty.')
  const url = URL.createObjectURL(blob)
  try {
    if (kind === 'image') {
      const image = await loadImage(url)
      return { width: image.naturalWidth, height: image.naturalHeight, duration: null }
    }
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.src = url
    await waitForMediaMetadata(video)
    const duration = await readFiniteDuration(video)
    if (!video.videoWidth || !video.videoHeight || !duration || duration <= 0) {
      throw new Error('The output could not be decoded as a playable video.')
    }
    return { width: video.videoWidth, height: video.videoHeight, duration }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Audio-only converter targets need a decoded, finite duration check too. */
export async function verifyRenderedAudio(blob: Blob): Promise<{ duration: number }> {
  if (!blob.size) throw new Error('The audio output is empty.')
  const url = URL.createObjectURL(blob)
  const audio = document.createElement('audio')
  audio.preload = 'metadata'
  audio.src = url
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('Timed out while reading the audio output.')), 15_000)
      const finish = (error?: Error) => {
        window.clearTimeout(timeout)
        audio.removeEventListener('loadedmetadata', onMetadata)
        audio.removeEventListener('error', onError)
        if (error) reject(error)
        else if (Number.isFinite(audio.duration) && audio.duration > 0) resolve(audio.duration)
        else reject(new Error('The audio output has no finite duration.'))
      }
      const onMetadata = () => finish()
      const onError = () => finish(new Error('The browser could not decode the audio output.'))
      audio.addEventListener('loadedmetadata', onMetadata, { once: true })
      audio.addEventListener('error', onError, { once: true })
      audio.load()
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) finish()
    })
    return { duration }
  } finally {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    URL.revokeObjectURL(url)
  }
}

export function canvasOutputMimeSupported(mime: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    return document.createElement('canvas').toDataURL(mime).startsWith(`data:${mime}`)
  } catch {
    return false
  }
}

async function drawFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  crop: { x: number; y: number; width: number; height: number },
  options: BrowserRenderOptions,
  watermarkImage: HTMLImageElement | null,
) {
  const effects = options.variation.effects
  context.save()
  context.filter = `brightness(${Math.max(0, 100 + effects.brightness)}%) contrast(${Math.max(0, 100 + effects.contrast)}%) saturate(${Math.max(0, 100 + effects.saturation)}%) hue-rotate(${effects.hue}deg)`
  context.fillStyle = '#000'
  context.fillRect(0, 0, targetWidth, targetHeight)

  const radians = effects.rotation * Math.PI / 180
  const rotationCover = Math.max(
    Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) * targetHeight / targetWidth,
    Math.abs(Math.sin(radians)) * targetWidth / targetHeight + Math.abs(Math.cos(radians)),
  )
  const shiftCover = 1 + 2 * Math.max(Math.abs(effects.shiftX), Math.abs(effects.shiftY)) / 100
  const scale = Math.max(1, effects.zoom, rotationCover, shiftCover)
  context.translate(targetWidth / 2 + effects.shiftX / 100 * targetWidth, targetHeight / 2 + effects.shiftY / 100 * targetHeight)
  context.rotate(radians)
  context.scale(scale * (options.flipHorizontal ? -1 : 1), scale * (options.flipVertical ? -1 : 1))
  context.drawImage(
    source,
    Math.min(crop.x, Math.max(0, sourceWidth - 1)),
    Math.min(crop.y, Math.max(0, sourceHeight - 1)),
    Math.min(crop.width, sourceWidth),
    Math.min(crop.height, sourceHeight),
    -targetWidth / 2,
    -targetHeight / 2,
    targetWidth,
    targetHeight,
  )
  context.restore()
  context.filter = 'none'

  drawCaption(context, options.caption, targetWidth, targetHeight)
  drawWatermark(context, options.watermark, targetWidth, targetHeight, watermarkImage)
}

function drawCaption(context: CanvasRenderingContext2D, caption: CaptionRenderSettings, width: number, height: number) {
  const text = caption.text.trim()
  if (!text) return
  const fontSize = Math.max(12, Math.min(caption.size, height * 0.12))
  context.save()
  context.font = `600 ${fontSize}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.shadowColor = 'rgba(0, 0, 0, .45)'
  context.shadowBlur = Math.max(2, fontSize * 0.14)
  context.shadowOffsetY = Math.max(1, fontSize * 0.06)
  const maxWidth = width * 0.82
  const lines = wrapText(context, text, maxWidth)
  const lineHeight = fontSize * 1.18
  const x = Math.min(width - 10, Math.max(10, width * caption.x / 100))
  const centerY = Math.min(height - 10, Math.max(10, height * caption.y / 100))
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2
  for (let index = 0; index < lines.length; index += 1) {
    const y = startY + index * lineHeight
    context.lineWidth = Math.max(2, fontSize * 0.12)
    context.strokeStyle = 'rgba(0, 0, 0, .82)'
    context.strokeText(lines[index], x, y, maxWidth)
    context.fillStyle = caption.color
    context.fillText(lines[index], x, y, maxWidth)
  }
  context.restore()
}

function drawWatermark(context: CanvasRenderingContext2D, watermark: WatermarkRenderSettings, width: number, height: number, image: HTMLImageElement | null) {
  context.save()
  context.globalAlpha = Math.max(0, Math.min(1, watermark.opacity / 100))
  if (watermark.imageUrl && image) {
      const targetWidth = Math.max(12, width * watermark.scale / 100)
      const targetHeight = targetWidth * image.naturalHeight / image.naturalWidth
      const x = Math.max(0, Math.min(width - targetWidth, width * watermark.x / 100 - targetWidth / 2))
      const y = Math.max(0, Math.min(height - targetHeight, height * watermark.y / 100 - targetHeight / 2))
      context.drawImage(image, x, y, targetWidth, targetHeight)
  } else if (watermark.text.trim()) {
    const fontSize = Math.max(12, Math.min(width * watermark.scale / 100, height * 0.15))
    context.font = `600 ${fontSize}px Arial, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#fff'
    context.shadowColor = 'rgba(0, 0, 0, .7)'
    context.shadowBlur = Math.max(2, fontSize * 0.14)
    context.fillText(watermark.text, width * watermark.x / 100, height * watermark.y / 100, width * 0.7)
  }
  context.restore()
}

async function loadWatermark(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null
  try {
    return await loadImage(url)
  } catch {
    throw new Error('The watermark image could not be decoded.')
  }
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines.slice(0, 8)
}

function selectVideoMime(requested: BrowserRenderOptions['videoMime'], supported: string[]): string | null {
  const filter = requested === 'auto'
    ? supported
    : supported.filter((mime) => mime.startsWith(requested))
  if (requested === 'video/webm') {
    return filter.find((mime) => mime.toLowerCase().includes('vp8')) ?? filter[0] ?? null
  }
  return filter[0] ?? null
}

function extensionForMime(mime: string): string {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('avif')) return 'avif'
  return 'png'
}

function getVideoCaptureStream(video: HTMLVideoElement): MediaStream | null {
  const element = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }
  try {
    return element.captureStream?.() ?? element.mozCaptureStream?.() ?? null
  } catch {
    return null
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The browser could not decode this image.'))
    image.src = url
    if (image.complete && image.naturalWidth > 0) resolve(image)
  })
}

function makeThumbnail(source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }): string | null {
  const sourceWidth = source.videoWidth ?? source.naturalWidth ?? 0
  const sourceHeight = source.videoHeight ?? source.naturalHeight ?? 0
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const scale = Math.min(1, 320 / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72)
}

function waitForMediaMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Timed out while reading the media file.')), 15_000)
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onMetadata = () => finish()
    const onError = () => finish(new Error('The browser could not decode this media file. It may be unsupported or corrupted.'))
    video.addEventListener('loadedmetadata', onMetadata, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.load()
  })
}

function waitForSeek(video: HTMLVideoElement): Promise<void> {
  if (!video.seeking) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Timed out while seeking in the media file.')), 10_000)
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onSeeked = () => finish()
    const onError = () => finish(new Error('The browser could not seek to the requested media time.'))
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

async function readFiniteDuration(video: HTMLVideoElement): Promise<number | null> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  const originalTime = video.currentTime
  try {
    const seeked = new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 2500)
      video.addEventListener('seeked', () => {
        window.clearTimeout(timeout)
        resolve()
      }, { once: true })
    })
    video.currentTime = Number.MAX_SAFE_INTEGER
    if (video.seeking) await seeked
    else await Promise.race([seeked, nextFrame()])
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime
    video.currentTime = originalTime
    if (video.seeking) await waitForSeek(video)
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch {
    try {
      video.currentTime = originalTime
    } catch {
      // The caller receives an unavailable-duration state below.
    }
    return null
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error(`The browser could not encode an image as ${mime}.`))
    }, mime, quality)
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  const videoWithFrameCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameCallbackMetadata) => void) => number
  }
  // The render source is intentionally detached from the UI. Chromium can
  // stop delivering video-frame callbacks for detached elements, so only use
  // this path when a future caller renders an attached video.
  if (video.isConnected && videoWithFrameCallback.requestVideoFrameCallback) {
    return new Promise((resolve) => videoWithFrameCallback.requestVideoFrameCallback?.(() => resolve()))
  }
  return nextFrame()
}

function abortError(): Error {
  return new DOMException('Processing was cancelled.', 'AbortError')
}
