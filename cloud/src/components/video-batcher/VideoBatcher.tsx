'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, DragEvent, PointerEvent, ReactNode } from 'react'
import { Icon } from '@/components/console/ConsoleIcons'
import {
  COMPRESSION_PRESETS,
  CONVERT_TARGETS,
  createSeededRandom,
  DEFAULT_CONVERTER_SETTINGS,
  DEFAULT_EFFECT_RANGES,
  DEFAULT_METADATA_SETTINGS,
  EFFECT_DEFINITIONS,
  formatOutputName,
  renderConcurrencyLimit,
  resolveVariation,
  serializePreset,
  validateEffectRanges,
  validatePreset,
  type AspectRatio,
  type ConvertTarget,
  type ConverterSettings,
  type EffectKey,
  type EffectRange,
  type EffectRanges,
  type MetadataSettings,
  type ResolutionCap,
  type VideoBatcherPreset,
} from '@/lib/video-batcher'
import { exportPassActive, runExportPass } from '@/lib/video-batcher-ffmpeg'
import {
  detectBrowserMediaCapabilities,
  extractVideoFrame,
  inspectLocalMedia,
  renderImage,
  renderVideo,
  verifyRenderedAudio,
  verifyRenderedMedia,
  type AudioRenderSettings,
  type BrowserMediaCapabilities,
  type BrowserRenderOptions,
  type CaptionRenderSettings,
  type LocalMedia,
  type RenderedMedia,
  type WatermarkRenderSettings,
} from '@/lib/video-batcher-browser'

/** Which tool a page is (Geno, 2026-10-12): every workspace is its own route
 *  under /video-batcher, listed as sub-tabs under Tools in the sidebar, and
 *  drawn by the layout so the loaded files and the queue survive switching. */
export type WorkspaceTab = 'effects' | 'captions' | 'audio' | 'metadata' | 'watermark' | 'converter' | 'compressor' | 'downloads'
type JobStatus = 'queued' | 'processing' | 'completed' | 'fallback' | 'failed' | 'cancelled'

interface BatchJob {
  id: string
  sourceId: string
  sourceName: string
  sourceIndex: number
  variationIndex: number
  batchSeed: number
  runId: string
  status: JobStatus
  progress: number
  phase: string | null
  outputName: string | null
  outputUrl: string | null
  outputBytes: number | null
  outputMime: string | null
  outputWidth: number | null
  outputHeight: number | null
  outputDuration: number | null
  elapsedMs: number | null
  error: string | null
  warnings: string[]
}

interface BatchSettings {
  effects: EffectRanges
  variationCount: number
  aspectRatio: AspectRatio
  resolution: ResolutionCap
  videoMime: 'auto' | 'video/webm' | 'video/mp4'
  imageMime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'
  imageQuality: number
  videoBitrateMbps: number
  flipHorizontal: boolean
  flipVertical: boolean
  caption: CaptionRenderSettings
  audio: AudioRenderSettings
  watermark: WatermarkRenderSettings
  metadata: MetadataSettings
  converter: ConverterSettings
}

const TABS: { id: WorkspaceTab; label: string; icon: 'sliders' | 'type' | 'music' | 'image' | 'tag' | 'refresh' | 'layers' | 'download' }[] = [
  { id: 'effects', label: 'Effects', icon: 'sliders' },
  { id: 'captions', label: 'Captions', icon: 'type' },
  { id: 'audio', label: 'Audio', icon: 'music' },
  { id: 'metadata', label: 'Metadata', icon: 'tag' },
  { id: 'watermark', label: 'Watermark', icon: 'image' },
  { id: 'converter', label: 'Converter', icon: 'refresh' },
  { id: 'compressor', label: 'Compressor', icon: 'layers' },
  { id: 'downloads', label: 'Downloads', icon: 'download' },
]

/** The tool a URL belongs to — `/video-batcher/effects` → `effects`. The bare
 *  path and any stray segment land on Effects. */
export function workspaceFromPath(pathname: string): WorkspaceTab {
  const id = pathname.split('/')[2] ?? ''
  return (TABS.some((tab) => tab.id === id) ? id : 'effects') as WorkspaceTab
}

const BUILT_IN_PRESETS: { name: string; setup: (current: BatchSettings) => BatchSettings }[] = [
  {
    name: 'Light color variation',
    setup: (current) => ({
      ...current,
      effects: {
        ...current.effects,
        brightness: { enabled: true, min: -3, max: 3 },
        contrast: { enabled: true, min: -3, max: 3 },
        saturation: { enabled: true, min: -4, max: 4 },
        hue: { enabled: false, min: -2, max: 2 },
      },
    }),
  },
  {
    name: 'Subtle motion',
    setup: (current) => ({
      ...current,
      effects: {
        ...current.effects,
        zoom: { enabled: true, min: 1.02, max: 1.06 },
        shiftX: { enabled: true, min: -0.8, max: 0.8 },
        shiftY: { enabled: true, min: -0.8, max: 0.8 },
        rotation: { enabled: false, min: -0.5, max: 0.5 },
      },
    }),
  },
  {
    name: 'Social video export',
    setup: (current) => ({ ...current, aspectRatio: 'portrait', resolution: '1080p', videoBitrateMbps: 6 }),
  },
  {
    /* The studio side of ♻ Repurpose (2026-10-18): the same shape the Mac's
       automatic render uses (src/repurpose.py, docs/REPURPOSE.md) — mirror,
       slight zoom and colour drift, a small speed step, metadata scrubbed and
       a fresh MP4. For the case where a person drives the render by hand. */
    name: 'Repurpose — fresh video',
    setup: (current) => ({
      ...current,
      flipHorizontal: true,
      effects: {
        ...current.effects,
        brightness: { enabled: true, min: -3, max: 3 },
        contrast: { enabled: true, min: -4, max: 4 },
        saturation: { enabled: true, min: -5, max: 5 },
        hue: { enabled: true, min: -3, max: 3 },
        zoom: { enabled: true, min: 1.03, max: 1.08 },
        shiftX: { enabled: true, min: -0.6, max: 0.6 },
        shiftY: { enabled: true, min: -0.6, max: 0.6 },
        speed: { enabled: true, min: 1.01, max: 1.03 },
      },
      metadata: {
        ...(current.metadata ?? DEFAULT_METADATA_SETTINGS),
        variationTag: false,
        creationTime: true,
        comments: false,
        title: false,
        gps: true,
        sourceTags: true,
        cleanExport: true,
        encoderTagEnabled: false,
      },
      converter: { target: 'mp4', quality: 88 },
    }),
  },
]

const PRESET_STORAGE_KEY = 'social-transcriber.video-batcher.presets.v1'

export default function VideoBatcher({ workspace }: { workspace: WorkspaceTab }) {
  const [files, setFiles] = useState<LocalMedia[]>([])
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [effects, setEffects] = useState<EffectRanges>(() => structuredClone(DEFAULT_EFFECT_RANGES))
  const [variationCount, setVariationCount] = useState(3)
  // Keep the first server and browser renders identical; choose the session
  // seed only after hydration so it cannot invalidate the client tree.
  const [batchSeed, setBatchSeed] = useState(0)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('original')
  const [resolution, setResolution] = useState<ResolutionCap>('1080p')
  const [videoMime, setVideoMime] = useState<BatchSettings['videoMime']>('auto')
  const [imageMime, setImageMime] = useState<BatchSettings['imageMime']>('image/webp')
  const [imageQuality, setImageQuality] = useState(0.88)
  const [videoBitrateMbps, setVideoBitrateMbps] = useState(6)
  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [captionSize, setCaptionSize] = useState(48)
  const [captionColor, setCaptionColor] = useState('#ffffff')
  const [captionX, setCaptionX] = useState(50)
  const [captionY, setCaptionY] = useState(82)
  const [captionDrag, setCaptionDrag] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [audioVolumeDb, setAudioVolumeDb] = useState(0)
  const [audioFadeIn, setAudioFadeIn] = useState(0)
  const [audioFadeOut, setAudioFadeOut] = useState(0)
  const [audioEqLow, setAudioEqLow] = useState(0)
  const [audioEqMid, setAudioEqMid] = useState(0)
  const [audioEqHigh, setAudioEqHigh] = useState(0)
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkImageUrl, setWatermarkImageUrl] = useState<string | null>(null)
  const [watermarkImageName, setWatermarkImageName] = useState('')
  const [watermarkOpacity, setWatermarkOpacity] = useState(76)
  const [watermarkScale, setWatermarkScale] = useState(18)
  const [watermarkX, setWatermarkX] = useState(88)
  const [watermarkY, setWatermarkY] = useState(88)
  const [genericOutputNames, setGenericOutputNames] = useState(false)
  const [metadataSettings, setMetadataSettings] = useState<MetadataSettings>(() => structuredClone(DEFAULT_METADATA_SETTINGS))
  const [converterSettings, setConverterSettings] = useState<ConverterSettings>(() => structuredClone(DEFAULT_CONVERTER_SETTINGS))
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [capabilities, setCapabilities] = useState<BrowserMediaCapabilities | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [overallProgress, setOverallProgress] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)
  const [batchMessage, setBatchMessage] = useState('')
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [presets, setPresets] = useState<VideoBatcherPreset[]>([])
  const [presetMessage, setPresetMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const watermarkInputRef = useRef<HTMLInputElement>(null)
  const presetInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const ownedUrlsRef = useRef(new Set<string>())
  const abortRef = useRef<AbortController | null>(null)
  const pausedRef = useRef(false)
  const latestSettingsRef = useRef<BatchSettings | null>(null)
  const startTimeRef = useRef<number | null>(null)

  const activeMedia = useMemo(() => files.find((file) => file.id === activeFileId) ?? files[0] ?? null, [files, activeFileId])
  const validFiles = useMemo(() => files.filter((file) => !file.inspectionError && file.width > 0 && file.height > 0), [files])
  const captionPool = useMemo(() => captionText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), [captionText])
  const completedJobs = useMemo(() => jobs.filter((job) => job.status === 'completed'), [jobs])
  const fallbackJobs = useMemo(() => jobs.filter((job) => job.status === 'fallback'), [jobs])
  const readyJobs = useMemo(() => jobs.filter((job) => job.status === 'completed' || job.status === 'fallback'), [jobs])
  const failedJobs = useMemo(() => jobs.filter((job) => job.status === 'failed'), [jobs])
  const pendingJobs = useMemo(() => jobs.filter((job) => job.status === 'queued' || job.status === 'processing'), [jobs])
  const totalPlanned = validFiles.length * variationCount
  const validationError = validateEffectRanges(effects)
  const plannedConcurrency = renderConcurrencyLimit(validFiles.map((file) => file.kind), capabilities?.hardwareConcurrency ?? 2)

  useEffect(() => {
    setBatchSeed(Math.floor(Math.random() * 2 ** 31))
    setCapabilities(detectBrowserMediaCapabilities())
    try {
      const stored = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) ?? '[]') as unknown[]
      setPresets(stored.map(validatePreset).filter((preset): preset is VideoBatcherPreset => preset !== null))
    } catch {
      setPresets([])
    }
  }, [])

  useEffect(() => () => {
    for (const url of ownedUrlsRef.current) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    const player = videoPreviewRef.current
    if (!player) return
    const speed = effects.speed.enabled ? (effects.speed.min + effects.speed.max) / 2 : 1
    player.playbackRate = Math.max(0.25, Math.min(4, speed))
  }, [activeMedia?.url, effects.speed])

  const rememberUrl = useCallback((url: string) => {
    ownedUrlsRef.current.add(url)
    return url
  }, [])

  const releaseUrl = useCallback((url: string | null) => {
    if (!url) return
    URL.revokeObjectURL(url)
    ownedUrlsRef.current.delete(url)
  }, [])

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList)
    if (!incoming.length) return
    setIsImporting(true)
    setImportError(null)
    let firstAddedId: string | null = null
    const results: LocalMedia[] = []
    const errors: string[] = []
    const knownKeys = new Set(files.map((file) => `${file.file.name}:${file.file.size}:${file.file.lastModified}`))
    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (knownKeys.has(key)) continue
      knownKeys.add(key)
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      try {
        const inspected = await inspectLocalMedia(file, id)
        rememberUrl(inspected.url)
        results.push(inspected)
        firstAddedId ??= inspected.id
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Could not inspect this file.'}`)
      }
    }
    if (results.length) {
      setFiles((current) => [...current, ...results])
      setActiveFileId((current) => current ?? firstAddedId)
    }
    setImportError(errors.length ? errors.slice(0, 4).join(' ') : null)
    setIsImporting(false)
  }, [files, rememberUrl])

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files) void addFiles(event.currentTarget.files)
    event.currentTarget.value = ''
  }

  const onDropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDraggingFiles(false)
    void addFiles(event.dataTransfer.files)
  }

  const removeFile = (fileId: string) => {
    const removed = files.find((file) => file.id === fileId)
    if (removed) releaseUrl(removed.url)
    setFiles((current) => current.filter((file) => file.id !== fileId))
    setActiveFileId((current) => current === fileId ? files.find((file) => file.id !== fileId)?.id ?? null : current)
  }

  const clearFiles = () => {
    files.forEach((file) => releaseUrl(file.url))
    setFiles([])
    setActiveFileId(null)
    setImportError(null)
  }

  const updateEffect = (key: EffectKey, patch: Partial<EffectRange>) => {
    setEffects((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  }

  const updateMetadata = (patch: Partial<MetadataSettings>) => setMetadataSettings((current) => ({ ...current, ...patch }))
  const updateConverter = (patch: Partial<ConverterSettings>) => setConverterSettings((current) => ({ ...current, ...patch }))

  const makeSettings = useCallback((): BatchSettings => ({
    effects: structuredClone(effects),
    variationCount,
    aspectRatio,
    resolution,
    videoMime,
    imageMime,
    imageQuality,
    videoBitrateMbps,
    flipHorizontal,
    flipVertical,
    caption: { text: '', size: captionSize, color: captionColor, x: captionX, y: captionY },
    audio: { muted: audioMuted, volumeDb: audioVolumeDb, fadeIn: audioFadeIn, fadeOut: audioFadeOut, eqLow: audioEqLow, eqMid: audioEqMid, eqHigh: audioEqHigh },
    watermark: { text: watermarkText, imageUrl: watermarkImageUrl, opacity: watermarkOpacity, scale: watermarkScale, x: watermarkX, y: watermarkY },
    metadata: structuredClone(metadataSettings),
    converter: structuredClone(converterSettings),
  }), [effects, variationCount, aspectRatio, resolution, videoMime, imageMime, imageQuality, videoBitrateMbps, flipHorizontal, flipVertical, captionSize, captionColor, captionX, captionY, audioMuted, audioVolumeDb, audioFadeIn, audioFadeOut, audioEqLow, audioEqMid, audioEqHigh, watermarkText, watermarkImageUrl, watermarkOpacity, watermarkScale, watermarkX, watermarkY, metadataSettings, converterSettings])

  const updateJob = (id: string, patch: Partial<BatchJob>) => {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job))
  }

  const runJobs = async (tasks: BatchJob[], settings: BatchSettings) => {
    if (!tasks.length) return
    const controller = new AbortController()
    abortRef.current = controller
    pausedRef.current = false
    startTimeRef.current = performance.now()
    setIsRunning(true)
    setIsPaused(false)
    setOverallProgress(0)
    setBatchMessage(`Preparing ${tasks.length} local output${tasks.length === 1 ? '' : 's'}…`)

    const progressByTask = new Map(tasks.map((task) => [task.id, 0]))
    const setTaskProgress = (taskId: string, progress: number) => {
      progressByTask.set(taskId, Math.max(0, Math.min(1, progress)))
      const totalProgress = [...progressByTask.values()].reduce((sum, value) => sum + value, 0)
      setOverallProgress(totalProgress / tasks.length)
    }
    const markCancelled = (task: BatchJob, message: string) => {
      updateJob(task.id, { status: 'cancelled', progress: 0, error: message })
      setTaskProgress(task.id, 1)
    }

    const processTask = async (task: BatchJob) => {
      const media = files.find((file) => file.id === task.sourceId)
      if (controller.signal.aborted) {
        markCancelled(task, 'Cancelled before this output started.')
        return
      }
      if (!media) {
        updateJob(task.id, { status: 'failed', error: 'The original file is no longer in this batch.' })
        setTaskProgress(task.id, 1)
        return
      }
      while (pausedRef.current && !controller.signal.aborted) await waitMs(100)
      if (controller.signal.aborted) {
        markCancelled(task, 'Cancelled before this output started.')
        return
      }

      const startedAt = performance.now()
      const variation = resolveVariation(settings.effects, task.batchSeed, task.sourceIndex, task.variationIndex, captionPool.length)
      const caption = { ...settings.caption, text: captionPool[variation.captionIndex ?? 0] ?? '' }
      const stillTargetMime = imageTargetMime(settings.converter.target)
      const nativeWebmTarget = media.kind === 'video' && settings.converter.target === 'webm'
      let effectiveBitrate = settings.videoBitrateMbps
      if (settings.metadata.encoderParams) {
        const jitter = createSeededRandom(variation.seed ^ 0x2545f491)()
        effectiveBitrate = Math.round(Math.min(20, Math.max(0.5, effectiveBitrate * (0.94 + jitter * 0.12))) * 10) / 10
      }
      if (nativeWebmTarget && settings.converter.quality < 100) {
        effectiveBitrate = Math.min(effectiveBitrate, Math.max(0.5, 6 * settings.converter.quality / 100))
      }
      const requestedImageQuality = stillTargetMime
        ? Math.min(settings.imageQuality, settings.converter.quality / 100)
        : settings.imageQuality
      const options: BrowserRenderOptions = {
        variation,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        videoMime: nativeWebmTarget ? 'video/webm' : settings.videoMime,
        imageMime: media.kind === 'image' ? stillTargetMime ?? settings.imageMime : settings.imageMime,
        imageQuality: requestedImageQuality,
        videoBitrateMbps: effectiveBitrate,
        flipHorizontal: settings.flipHorizontal,
        flipVertical: settings.flipVertical,
        caption,
        watermark: settings.watermark,
        audio: settings.audio,
        signal: controller.signal,
        isPaused: () => pausedRef.current,
        onProgress: (progress) => {
          const bounded = Math.max(0, Math.min(1, progress))
          updateJob(task.id, { status: 'processing', progress: bounded })
          setTaskProgress(task.id, bounded)
          setBatchMessage(`Rendering ${task.sourceName} · variation ${task.variationIndex + 1} of ${settings.variationCount}`)
        },
      }

      updateJob(task.id, { status: 'processing', progress: 0, phase: null, error: null })
      try {
        let rendered: RenderedMedia = media.kind === 'image'
          ? await renderImage(media, options)
          : await renderVideo(media, options)
        if (controller.signal.aborted) throw new DOMException('Processing was cancelled.', 'AbortError')
        let outputKind: 'image' | 'video' = media.kind
        let converterSettings = settings.converter
        if (stillTargetMime && media.kind === 'video') {
          const renderedVideo = rendered
          const still = await extractVideoFrame(renderedVideo.blob, stillTargetMime, requestedImageQuality)
          rendered = { ...still, warnings: [...renderedVideo.warnings, ...still.warnings] }
          outputKind = 'image'
          converterSettings = { target: 'keep', quality: 100 }
        } else if (stillTargetMime && media.kind === 'image') {
          // Canvas already encoded this requested still format; leave the
          // FFmpeg pass for metadata only, avoiding a second lossy encode.
          converterSettings = { target: 'keep', quality: 100 }
        } else if (nativeWebmTarget) {
          // MediaRecorder already produced WebM. Avoid a second, fragile WASM
          // VP8 transcode when the requested container is the same.
          converterSettings = { target: 'keep', quality: 100 }
        }
        const renderedVerification = await verifyRenderedMedia(rendered.blob, outputKind)
        if (outputKind === 'video') assertDurationWithinTolerance(rendered.durationSeconds, renderedVerification.duration)

        let finalBlob = rendered.blob
        let finalMime = rendered.mimeType
        let finalExtension = rendered.extension
        let outputVerification = renderedVerification
        const passWarnings: string[] = []
        let exportFallback = false
        if (exportPassActive(settings.metadata, converterSettings)) {
          updateJob(task.id, { phase: 'Preparing the on-device export pass…' })
          const pass = await runExportPass(
            { blob: rendered.blob, extension: rendered.extension, mimeType: rendered.mimeType, kind: outputKind, durationSeconds: rendered.durationSeconds },
            settings.metadata,
            converterSettings,
            { seed: variation.seed, batchSeed: task.batchSeed, variationIndex: task.variationIndex, variationCount: settings.variationCount },
            {
              signal: controller.signal,
              onPhase: (phase) => updateJob(task.id, { phase }),
              onProgress: (progress) => {
                const bounded = 0.92 + Math.max(0, Math.min(1, progress)) * 0.08
                updateJob(task.id, { progress: bounded })
                setTaskProgress(task.id, bounded)
              },
            },
          )
          finalBlob = pass.blob
          finalMime = pass.mimeType
          finalExtension = pass.extension
          passWarnings.push(...pass.warnings)
          exportFallback = pass.fallback
        }
        if (controller.signal.aborted) throw new DOMException('Processing was cancelled.', 'AbortError')

        const finalMimeType = finalMime.split(';')[0]
        if (finalMimeType.startsWith('image/')) {
          outputVerification = await verifyRenderedMedia(finalBlob, 'image')
        } else if (finalMimeType === 'video/webm' || finalMimeType === 'video/mp4') {
          outputVerification = await verifyRenderedMedia(finalBlob, 'video')
          assertDurationWithinTolerance(rendered.durationSeconds, outputVerification.duration)
        } else if (finalMimeType.startsWith('audio/')) {
          const audioVerification = await verifyRenderedAudio(finalBlob)
          outputVerification = { width: 0, height: 0, duration: audioVerification.duration }
        }

        const name = formatOutputName(
          genericOutputNames ? 'media' : media.file.name,
          task.variationIndex,
          variation.seed,
          finalExtension,
          task.id,
        )
        const outputUrl = rememberUrl(URL.createObjectURL(finalBlob))
        updateJob(task.id, {
          status: exportFallback ? 'fallback' : 'completed',
          progress: 1,
          phase: null,
          outputName: name,
          outputUrl,
          outputBytes: finalBlob.size,
          outputMime: finalMime,
          outputWidth: finalMimeType.startsWith('audio/') ? null : outputVerification.width,
          outputHeight: finalMimeType.startsWith('audio/') ? null : outputVerification.height,
          outputDuration: outputVerification.duration,
          elapsedMs: Math.round(performance.now() - startedAt),
          warnings: [...rendered.warnings, ...passWarnings],
          error: null,
        })
      } catch (error) {
        const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
        updateJob(task.id, {
          status: cancelled ? 'cancelled' : 'failed',
          progress: 0,
          phase: null,
          elapsedMs: Math.round(performance.now() - startedAt),
          error: cancelled ? 'Cancelled.' : error instanceof Error ? error.message : 'The browser could not process this output.',
        })
      } finally {
        setTaskProgress(task.id, 1)
      }
    }

    const workerCount = Math.min(tasks.length, renderConcurrencyLimit(validFiles.map((file) => file.kind), capabilities?.hardwareConcurrency ?? 2))
    let nextTaskIndex = 0
    const worker = async () => {
      while (true) {
        while (pausedRef.current && !controller.signal.aborted) await waitMs(50)
        if (controller.signal.aborted) {
          while (nextTaskIndex < tasks.length) {
            markCancelled(tasks[nextTaskIndex++], 'Cancelled before this output started.')
          }
          return
        }
        const taskIndex = nextTaskIndex++
        if (taskIndex >= tasks.length) return
        await processTask(tasks[taskIndex])
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    abortRef.current = null
    pausedRef.current = false
    setIsPaused(false)
    setIsRunning(false)
    setOverallProgress(1)
    setBatchMessage(controller.signal.aborted
      ? 'Batch cancelled. Finished outputs remain available below.'
      : 'Batch finished. Clean and fallback outputs are identified below.')
  }

  const startBatch = () => {
    if (isRunning || !validFiles.length) return
    if (validationError) {
      setBatchMessage(validationError)
      return
    }
    if (validFiles.some((file) => file.kind === 'video') && (!capabilities?.canRecordVideo || !capabilities.canCaptureCanvas)) {
      setBatchMessage('This browser cannot record processed video. Image exports can still be generated here.')
      return
    }
    if (validFiles.some((file) => file.kind === 'video') && videoMime !== 'auto' && !capabilities?.videoMimeTypes.some((mime) => mime.startsWith(videoMime))) {
      setBatchMessage(`The selected ${videoMime.split('/')[1].toUpperCase()} recorder is not supported here. Choose Automatic format.`)
      return
    }
    if (validFiles.some((file) => file.kind === 'image') && !capabilities?.imageMimeTypes.includes(imageMime)) {
      setBatchMessage(`The selected image format ${imageMime.replace('image/', '').toUpperCase()} is not supported here.`)
      return
    }
    const targetStillMime = imageTargetMime(converterSettings.target)
    if (targetStillMime && !capabilities?.imageMimeTypes.includes(targetStillMime)) {
      setBatchMessage(`The selected still output ${targetStillMime.replace('image/', '').toUpperCase()} is not supported here.`)
      return
    }
    const settings = makeSettings()
    latestSettingsRef.current = settings
    const runId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const currentBatchSeed = batchSeed >>> 0
    const tasks = validFiles.flatMap((media, sourceIndex) => Array.from({ length: variationCount }, (_, variationIndex): BatchJob => ({
      id: `${runId}-${sourceIndex}-${variationIndex}`,
      sourceId: media.id,
      sourceName: media.file.name,
      sourceIndex,
      variationIndex,
      batchSeed: currentBatchSeed,
      runId,
      status: 'queued',
      progress: 0,
      phase: null,
      outputName: null,
      outputUrl: null,
      outputBytes: null,
      outputMime: null,
      outputWidth: null,
      outputHeight: null,
      outputDuration: null,
      elapsedMs: null,
      error: null,
      warnings: [],
    })))
    setJobs((current) => [...tasks, ...current])
    setBatchMessage('')
    void runJobs(tasks, settings)
  }

  const togglePause = () => {
    pausedRef.current = !pausedRef.current
    setIsPaused(pausedRef.current)
    setBatchMessage(pausedRef.current ? 'Paused after the current frame.' : 'Resuming local render…')
  }

  const cancelBatch = () => abortRef.current?.abort()

  const retryJob = (job: BatchJob) => {
    if (isRunning || !latestSettingsRef.current) return
    if (job.outputUrl) releaseUrl(job.outputUrl)
    updateJob(job.id, { status: 'queued', progress: 0, phase: null, outputName: null, outputUrl: null, outputBytes: null, outputMime: null, outputWidth: null, outputHeight: null, outputDuration: null, elapsedMs: null, error: null, warnings: [] })
    void runJobs([{ ...job, status: 'queued', outputUrl: null, error: null }], latestSettingsRef.current)
  }

  const removeJob = (job: BatchJob) => {
    releaseUrl(job.outputUrl)
    setJobs((current) => current.filter((item) => item.id !== job.id))
  }

  const clearDownloads = () => {
    jobs.filter((job) => job.status === 'completed' || job.status === 'fallback' || job.status === 'failed' || job.status === 'cancelled').forEach((job) => releaseUrl(job.outputUrl))
    setJobs((current) => current.filter((job) => job.status === 'queued' || job.status === 'processing'))
  }

  const downloadJob = (job: BatchJob) => {
    if (!job.outputUrl || !job.outputName) return
    const link = document.createElement('a')
    link.href = job.outputUrl
    link.download = job.outputName
    link.click()
  }

  const buildPreset = (name: string): VideoBatcherPreset => {
    const settings = makeSettings()
    return {
      schemaVersion: 1,
      name,
      settings: {
        effects: settings.effects,
        variations: settings.variationCount,
        batchSeed: batchSeed >>> 0,
        videoMime: settings.videoMime,
        imageMime: settings.imageMime,
        imageQuality: settings.imageQuality,
        flipHorizontal: settings.flipHorizontal,
        flipVertical: settings.flipVertical,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        videoBitrateMbps: settings.videoBitrateMbps,
        genericOutputNames,
        captionText,
        captionSize,
        captionColor,
        captionX,
        captionY,
        audioMuted,
        audioVolumeDb,
        audioFadeIn,
        audioFadeOut,
        audioEqLow,
        audioEqMid,
        audioEqHigh,
        watermarkText,
        watermarkOpacity,
        watermarkScale,
        watermarkX,
        watermarkY,
        metadata: structuredClone(metadataSettings),
        converter: structuredClone(converterSettings),
      },
    }
  }

  const applyPreset = (preset: VideoBatcherPreset) => {
    setEffects(structuredClone(preset.settings.effects))
    setVariationCount(preset.settings.variations)
    setBatchSeed(preset.settings.batchSeed)
    setVideoMime(preset.settings.videoMime)
    setImageMime(preset.settings.imageMime)
    setImageQuality(preset.settings.imageQuality)
    setFlipHorizontal(preset.settings.flipHorizontal)
    setFlipVertical(preset.settings.flipVertical)
    setAspectRatio(preset.settings.aspectRatio)
    setResolution(preset.settings.resolution)
    setVideoBitrateMbps(preset.settings.videoBitrateMbps)
    setGenericOutputNames(preset.settings.genericOutputNames)
    setCaptionText(preset.settings.captionText)
    setCaptionSize(preset.settings.captionSize)
    setCaptionColor(preset.settings.captionColor)
    setCaptionX(preset.settings.captionX)
    setCaptionY(preset.settings.captionY)
    setAudioMuted(preset.settings.audioMuted)
    setAudioVolumeDb(preset.settings.audioVolumeDb)
    setAudioFadeIn(preset.settings.audioFadeIn)
    setAudioFadeOut(preset.settings.audioFadeOut)
    setAudioEqLow(preset.settings.audioEqLow)
    setAudioEqMid(preset.settings.audioEqMid)
    setAudioEqHigh(preset.settings.audioEqHigh)
    setWatermarkText(preset.settings.watermarkText)
    setWatermarkOpacity(preset.settings.watermarkOpacity)
    setWatermarkScale(preset.settings.watermarkScale)
    setWatermarkX(preset.settings.watermarkX)
    setWatermarkY(preset.settings.watermarkY)
    if (preset.settings.metadata) setMetadataSettings(structuredClone(preset.settings.metadata))
    if (preset.settings.converter) setConverterSettings(structuredClone(preset.settings.converter))
    setPresetMessage(`Loaded “${preset.name}”.`)
  }

  const savePreset = () => {
    const name = window.prompt('Name this preset')?.trim()
    if (!name) return
    const preset = validatePreset(buildPreset(name))
    if (!preset) {
      setPresetMessage('Preset validation failed. Check the current ranges and values.')
      return
    }
    const next = [...presets.filter((item) => item.name.toLowerCase() !== preset.name.toLowerCase()), preset]
    setPresets(next)
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
    setPresetMessage(`Saved “${preset.name}” in this browser.`)
  }

  const exportPreset = () => {
    const data = new Blob([serializePreset(buildPreset('Video Batcher preset'))], { type: 'application/json' })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = 'video-batcher-preset.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importPreset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const preset = validatePreset(JSON.parse(await file.text()))
      if (!preset) throw new Error('The JSON file does not match a supported Video Batcher preset.')
      const next = [...presets.filter((item) => item.name.toLowerCase() !== preset.name.toLowerCase()), preset]
      setPresets(next)
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
      applyPreset(preset)
    } catch (error) {
      setPresetMessage(error instanceof Error ? error.message : 'Could not import that preset.')
    }
  }

  const renamePreset = (preset: VideoBatcherPreset) => {
    const name = window.prompt('Rename preset', preset.name)?.trim()
    if (!name) return
    const next = presets.map((item) => item === preset ? { ...item, name: name.slice(0, 60) } : item)
    setPresets(next)
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
    setPresetMessage(`Renamed preset to “${name}”.`)
  }

  const duplicatePreset = (preset: VideoBatcherPreset) => {
    const name = `${preset.name} copy`.slice(0, 60)
    const nextPreset = { ...structuredClone(preset), name }
    const next = [...presets, nextPreset]
    setPresets(next)
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
    setPresetMessage(`Duplicated as “${name}”.`)
  }

  const deletePreset = (preset: VideoBatcherPreset) => {
    if (!window.confirm(`Delete the “${preset.name}” preset?`)) return
    const next = presets.filter((item) => item !== preset)
    setPresets(next)
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
    setPresetMessage(`Deleted “${preset.name}”.`)
  }

  const previewEffects = useMemo(() => Object.fromEntries(EFFECT_DEFINITIONS.map(({ key, neutral }) => {
    const range = effects[key]
    return [key, range.enabled ? (range.min + range.max) / 2 : neutral]
  })) as Record<EffectKey, number>, [effects])
  const previewStyle: CSSProperties = {
    filter: `brightness(${Math.max(0, 100 + previewEffects.brightness)}%) contrast(${Math.max(0, 100 + previewEffects.contrast)}%) saturate(${Math.max(0, 100 + previewEffects.saturation)}%) hue-rotate(${previewEffects.hue}deg)`,
    transform: `translate(${previewEffects.shiftX}%, ${previewEffects.shiftY}%) scale(${previewEffects.zoom}) rotate(${previewEffects.rotation}deg) scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`,
  }
  const previewCaptionSize = activeMedia && stageRef.current
    ? Math.max(12, captionSize * Math.min(1, stageRef.current.clientHeight / (activeMedia.height || 1080)))
    : 20

  /** The preview frame wears the shape the output will have: the source's own
   *  ratio (9:16 stays 9:16), or the chosen crop when the Converter overrides
   *  the aspect. CSS sizes the frame inside the stage from these two vars:
   *  `--vb-frame-ratio` is the aspect-ratio, `--vb-frame-ratio-num` is
   *  width ÷ height so `stageHeight × num` is the fitting width. */
  const frameRatioStyle = useMemo<CSSProperties>(() => {
    if (!activeMedia) return {}
    const presets: Record<AspectRatio, [number, number] | null> = { original: null, portrait: [9, 16], landscape: [16, 9], square: [1, 1] }
    const chosen = presets[aspectRatio] ?? [activeMedia.width || 16, activeMedia.height || 9]
    return {
      '--vb-frame-ratio': `${chosen[0]} / ${chosen[1]}`,
      '--vb-frame-ratio-num': String(chosen[0] / chosen[1]),
    } as CSSProperties
  }, [activeMedia, aspectRatio])

  const updateCaptionPosition = (event: PointerEvent<HTMLDivElement>) => {
    if (!captionDrag || !stageRef.current) return
    const bounds = stageRef.current.getBoundingClientRect()
    setCaptionX(Math.round(Math.min(96, Math.max(4, ((event.clientX - bounds.left) / bounds.width) * 100))))
    setCaptionY(Math.round(Math.min(96, Math.max(4, ((event.clientY - bounds.top) / bounds.height) * 100))))
  }

  return (
    <div className="video-batcher">
      <header className="vb-heading">
        <div>
          <p className="vb-kicker">LOCAL MEDIA STUDIO</p>
          <h1>Video Batcher</h1>
          <p className="vb-subtitle">Make controlled variations and browser-supported exports. Media stays on this device.</p>
        </div>
        <div className="vb-local-mark" aria-label="Local processing enabled">
          <span className="vb-local-dot" />
          <span>On-device processing</span>
        </div>
      </header>

      <section
        className={`vb-source ${draggingFiles ? 'is-dragging' : ''}`}
        aria-label="Source media"
        onDragOver={(event) => { event.preventDefault(); setDraggingFiles(true) }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false) }}
        onDrop={onDropFiles}
      >
        <div className="vb-source-head">
          <div className="vb-source-title">
            <h2>Source media</h2>
            <span>{files.length} {files.length === 1 ? 'file' : 'files'} · {isImporting ? 'Inspecting…' : 'local only'}</span>
          </div>
          <div className="vb-source-actions">
            <input ref={fileInputRef} type="file" accept="video/*,image/*" multiple hidden onChange={onPickFiles} aria-label="Choose video and image files" />
            <button type="button" className="vb-button vb-button-quiet" onClick={() => fileInputRef.current?.click()} disabled={isRunning || isImporting}>
              <Icon name="plus" size={15} /> Add files
            </button>
            {files.length > 0 && <button type="button" className="vb-text-button" onClick={clearFiles} disabled={isRunning}>Clear files</button>}
          </div>
        </div>

        {files.length === 0 ? (
          <button
            type="button"
            className="vb-dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDraggingFiles(true) }}
          >
            <span className="vb-drop-icon"><Icon name="upload" size={21} /></span>
            <strong>{isImporting ? 'Inspecting media…' : draggingFiles ? 'Drop files to add them' : 'Drop videos or images here'}</strong>
            <span>or browse files · video &amp; image</span>
          </button>
        ) : (
          <div className="vb-file-list">
            {files.map((media) => (
              <div className={`vb-file-row ${activeMedia?.id === media.id ? 'is-active' : ''}`} key={media.id}>
                <button type="button" className="vb-file-select" onClick={() => setActiveFileId(media.id)} aria-pressed={activeMedia?.id === media.id}>
                  <span className="vb-file-thumb">
                    {media.thumbnail ? <img src={media.thumbnail} alt="" /> : <Icon name={media.kind === 'video' ? 'video' : 'image'} size={17} />}
                    <i>{media.kind === 'video' ? 'VIDEO' : 'IMAGE'}</i>
                  </span>
                  <span className="vb-file-copy">
                    <strong title={media.file.name}>{media.file.name}</strong>
                    <small>{formatBytes(media.file.size)} <span>·</span> {media.width && media.height ? `${media.width} × ${media.height}` : 'dimensions unavailable'}{media.duration !== null ? ` · ${formatDuration(media.duration)}` : ''}</small>
                    {media.inspectionError && <small className="vb-error-text">{media.inspectionError}</small>}
                  </span>
                </button>
                <span className="vb-file-state">{media.inspectionError ? 'Unreadable' : 'Ready'}</span>
                <button type="button" className="vb-icon-button" aria-label={`Remove ${media.file.name}`} onClick={() => removeFile(media.id)} disabled={isRunning}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="vb-add-more" onClick={() => fileInputRef.current?.click()} disabled={isRunning || isImporting}>
              <Icon name="plus" size={14} /> Add more files
            </button>
          </div>
        )}
        {importError && <p className="vb-inline-error" role="alert">{importError}</p>}

        <div className="vb-presets">
          <div className="vb-presets-head">
            <p className="vb-rail-label">PRESETS</p>
            <div className="vb-preset-actions">
              <button type="button" className="vb-text-button" onClick={savePreset} disabled={isRunning}>Save</button>
              <button type="button" className="vb-text-button" onClick={() => presetInputRef.current?.click()} disabled={isRunning}>Import</button>
              <button type="button" className="vb-text-button" onClick={exportPreset} disabled={isRunning}>Export</button>
            </div>
          </div>
          <input ref={presetInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importPreset(event)} />
          <select className="vb-select vb-preset-select" aria-label="Load a saved preset" value="" onChange={(event) => {
            const value = event.target.value
            if (value.startsWith('builtin:')) {
              const preset = BUILT_IN_PRESETS.find((item) => item.name === value.slice('builtin:'.length))
              if (preset) {
                const next = preset.setup(makeSettings())
                setEffects(next.effects)
                setAspectRatio(next.aspectRatio)
                setResolution(next.resolution)
                setVideoBitrateMbps(next.videoBitrateMbps)
                setPresetMessage(`Loaded “${preset.name}”.`)
              }
            } else {
              const preset = presets[Number(value)]
              if (preset) applyPreset(preset)
            }
          }}>
            <option value="">Load preset…</option>
            {BUILT_IN_PRESETS.map((preset) => <option key={preset.name} value={`builtin:${preset.name}`}>{preset.name}</option>)}
            {presets.map((preset, index) => <option key={`${preset.name}-${index}`} value={String(index)}>{preset.name}</option>)}
          </select>
          {presets.length > 0 && <div className="vb-saved-presets">
            {presets.map((preset) => (
              <div key={preset.name}>
                <span title={preset.name}>{preset.name}</span>
                <button type="button" onClick={() => renamePreset(preset)} aria-label={`Rename ${preset.name}`}>Rename</button>
                <button type="button" onClick={() => duplicatePreset(preset)} aria-label={`Duplicate ${preset.name}`}>Copy</button>
                <button type="button" onClick={() => deletePreset(preset)} aria-label={`Delete ${preset.name}`}>Delete</button>
              </div>
            ))}
          </div>}
          {presetMessage && <p className="vb-quiet-note" role="status">{presetMessage}</p>}
        </div>
      </section>

      <div className="vb-studio">
        {/* Every tool is its own page (sidebar, under Tools). The frame is laid
            out on .video-batcher itself; this wrapper is display: contents, so
            the settings and preview columns slot straight into the frame grid. */}

        <section className="vb-settings" aria-label={`${TABS.find((tab) => tab.id === workspace)?.label ?? ''} settings`}>
          <div className="vb-panel-head">
            <div>
              <p className="vb-kicker">{workspace === 'converter' ? 'OUTPUT' : workspace === 'compressor' ? 'SIZE' : workspace === 'metadata' ? 'REPURPOSING' : 'EDITING'}</p>
              <h2>{TABS.find((tab) => tab.id === workspace)?.label}</h2>
            </div>
            {workspace === 'effects' && <button type="button" className="vb-icon-button" title="Generate a new reproducible seed" aria-label="Randomize batch seed" onClick={() => setBatchSeed(Math.floor(Math.random() * 2 ** 31))} disabled={isRunning}><Icon name="dice" size={16} /></button>}
          </div>

          {workspace === 'effects' && <div className="vb-panel-body">
            <p className="vb-panel-description">Each output samples only enabled ranges. Matching minimum and maximum applies a fixed value.</p>
            <div className="vb-control-grid">
              <label className="vb-check-row"><input type="checkbox" checked={flipHorizontal} onChange={(event) => setFlipHorizontal(event.target.checked)} disabled={isRunning} /><span><strong>Flip horizontal</strong><small>Mirror left to right.</small></span></label>
              <label className="vb-check-row"><input type="checkbox" checked={flipVertical} onChange={(event) => setFlipVertical(event.target.checked)} disabled={isRunning} /><span><strong>Flip vertical</strong><small>Mirror top to bottom.</small></span></label>
            </div>
            <div className="vb-effect-section"><h3>Color & tone</h3>
              {EFFECT_DEFINITIONS.slice(0, 4).map((definition) => <RangeControl key={definition.key} definition={definition} value={effects[definition.key]} disabled={isRunning} onChange={(patch) => updateEffect(definition.key, patch)} />)}
            </div>
            <div className="vb-effect-section"><h3>Framing & motion</h3>
              {EFFECT_DEFINITIONS.slice(4, 8).map((definition) => <RangeControl key={definition.key} definition={definition} value={effects[definition.key]} disabled={isRunning} onChange={(patch) => updateEffect(definition.key, patch)} />)}
            </div>
            <div className="vb-effect-section"><h3>Timing & length</h3>
              {EFFECT_DEFINITIONS.slice(8).map((definition) => <RangeControl key={definition.key} definition={definition} value={effects[definition.key]} disabled={isRunning} onChange={(patch) => updateEffect(definition.key, patch)} />)}
            </div>
            <p className="vb-seed-line">Batch seed <code>{batchSeed >>> 0}</code><span>· each output also gets its own deterministic seed</span></p>
          </div>}

          {workspace === 'captions' && <div className="vb-panel-body">
            <p className="vb-panel-description">One caption is selected deterministically for each variation. Put multiple captions on separate lines.</p>
            <label className="vb-field-label" htmlFor="vb-caption-list">Caption library <span>{captionPool.length} entries</span></label>
            <textarea id="vb-caption-list" className="vb-textarea" value={captionText} onChange={(event) => setCaptionText(event.target.value)} placeholder={'A short line that fits the clip\nAnother caption option'} disabled={isRunning} rows={5} />
            <div className="vb-control-grid">
              <label className="vb-form-field"><span>Font size</span><div className="vb-input-unit"><input type="number" min="12" max="160" value={captionSize} onChange={(event) => setCaptionSize(numberValue(event, 48, 12, 160))} disabled={isRunning} /><i>px</i></div></label>
              <label className="vb-form-field"><span>Text color</span><input className="vb-color-input" type="color" value={captionColor} onChange={(event) => setCaptionColor(event.target.value)} disabled={isRunning} /></label>
              <label className="vb-form-field"><span>Horizontal position</span><input type="range" min="4" max="96" value={captionX} onChange={(event) => setCaptionX(Number(event.target.value))} disabled={isRunning} /></label>
              <label className="vb-form-field"><span>Vertical position</span><input type="range" min="4" max="96" value={captionY} onChange={(event) => setCaptionY(Number(event.target.value))} disabled={isRunning} /></label>
            </div>
            <p className="vb-quiet-note">Drag the caption in the preview to position it. Captions are burned into the rendered frames.</p>
          </div>}

          {workspace === 'audio' && <div className="vb-panel-body">
            <p className="vb-panel-description">Audio stays synchronized when playback speed changes. Browser Web Audio applies volume, fades, and a three-band EQ during recording.</p>
            <label className="vb-check-row"><input type="checkbox" checked={audioMuted} onChange={(event) => setAudioMuted(event.target.checked)} disabled={isRunning} /><span><strong>Remove audio</strong><small>Export video without an audio track.</small></span></label>
            <AudioRange label="Volume" value={audioVolumeDb} min={-24} max={12} unit="dB" disabled={isRunning} onChange={setAudioVolumeDb} />
            <div className="vb-control-grid">
              <label className="vb-form-field"><span>Fade in</span><div className="vb-input-unit"><input type="number" min="0" max="30" step="0.1" value={audioFadeIn} onChange={(event) => setAudioFadeIn(numberValue(event, 0, 0, 30))} disabled={isRunning || audioMuted} /><i>s</i></div></label>
              <label className="vb-form-field"><span>Fade out</span><div className="vb-input-unit"><input type="number" min="0" max="30" step="0.1" value={audioFadeOut} onChange={(event) => setAudioFadeOut(numberValue(event, 0, 0, 30))} disabled={isRunning || audioMuted} /><i>s</i></div></label>
            </div>
            <div className="vb-effect-section"><h3>Equalizer</h3>
              <AudioRange label="Low · 120 Hz" value={audioEqLow} min={-12} max={12} unit="dB" disabled={isRunning || audioMuted} onChange={setAudioEqLow} />
              <AudioRange label="Mid · 1 kHz" value={audioEqMid} min={-12} max={12} unit="dB" disabled={isRunning || audioMuted} onChange={setAudioEqMid} />
              <AudioRange label="High · 8 kHz" value={audioEqHigh} min={-12} max={12} unit="dB" disabled={isRunning || audioMuted} onChange={setAudioEqHigh} />
            </div>
          </div>}

          {workspace === 'metadata' && <div className="vb-panel-body">
            <div className="vb-meta-section">
              <div className="vb-meta-section-head">
                <strong>Automatic Metadata Randomization</strong>
                <p>Applied to every variation — deterministic from the batch seed.</p>
                <p>Variation tag, titles, comments, and encoding quality per variation.</p>
              </div>
              <div className="vb-meta-grid">
                <MetaSwitchCard label="Variation Tag" description="Unique identifier (variation, seed, batch) in the file description." on={metadataSettings.variationTag} disabled={isRunning} onChange={(on) => updateMetadata({ variationTag: on })} />
                <MetaSwitchCard label="Creation Time" description="Keep source, export time, or custom." on={metadataSettings.creationTime} disabled={isRunning} onChange={(on) => updateMetadata({ creationTime: on })} />
                <MetaSwitchCard label="File Comments" description="Comment per variation." on={metadataSettings.comments} disabled={isRunning} onChange={(on) => updateMetadata({ comments: on })} />
                <MetaSwitchCard label="Title" description="Title per variation." on={metadataSettings.title} disabled={isRunning} onChange={(on) => updateMetadata({ title: on })} />
                <MetaSwitchCard label="Encoder Parameters" description="CRF jitter around batch quality." on={metadataSettings.encoderParams} disabled={isRunning} onChange={(on) => updateMetadata({ encoderParams: on })} />
                <MetaSwitchCard label="Encoder Tag" description="Software tag in the file." on={metadataSettings.encoderTagEnabled} disabled={isRunning} onChange={(on) => updateMetadata({ encoderTagEnabled: on })}>
                  {metadataSettings.encoderTagEnabled && <input className="vb-input" value={metadataSettings.encoderTag} maxLength={80} placeholder="Video Batcher Studio" disabled={isRunning} onChange={(event) => updateMetadata({ encoderTag: event.target.value })} aria-label="Encoder tag value" />}
                </MetaSwitchCard>
              </div>
            </div>
            <div className="vb-meta-section">
              <div className="vb-meta-section-head">
                <strong>Privacy &amp; Cleanup</strong>
                <p>Keeps exports private and predictable.</p>
              </div>
              <div className="vb-meta-grid">
                <MetaSwitchCard label="GPS Data" description="Removes location metadata." on={metadataSettings.gps} disabled={isRunning} onChange={(on) => updateMetadata({ gps: on })} />
                <MetaSwitchCard label="Source Tags" description="Removes camera and editor tags." on={metadataSettings.sourceTags} disabled={isRunning} onChange={(on) => updateMetadata({ sourceTags: on })} />
                <MetaSwitchCard label="Clean Export" description="Minimal metadata, no carried-over tags." on={metadataSettings.cleanExport} disabled={isRunning} onChange={(on) => updateMetadata({ cleanExport: on })} />
              </div>
            </div>
            <label className="vb-check-row"><input type="checkbox" checked={genericOutputNames} onChange={(event) => setGenericOutputNames(event.target.checked)} disabled={isRunning} /><span><strong>Use generic output names</strong><small>Save as media_v001… instead of including the source filename.</small></span></label>
            <p className="vb-quiet-note">Every export is re-recorded locally first, so source GPS, camera, and editor tags never carry over. The enabled fields above are written into the finished file by the on-device converter — its first run downloads once (~31 MB) and is then cached. Nothing leaves this device.</p>
          </div>}

          {workspace === 'watermark' && <div className="vb-panel-body">
            <p className="vb-panel-description">Add a text mark or image logo to every output. Its placement scales with the final frame.</p>
            <label className="vb-field-label" htmlFor="vb-watermark-text">Text watermark</label>
            <input id="vb-watermark-text" className="vb-input" value={watermarkText} onChange={(event) => setWatermarkText(event.target.value)} placeholder="Studio / handle" disabled={isRunning} />
            <input ref={watermarkInputRef} type="file" accept="image/*" hidden onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              releaseUrl(watermarkImageUrl)
              const url = rememberUrl(URL.createObjectURL(file))
              setWatermarkImageUrl(url)
              setWatermarkImageName(file.name)
            }} />
            <div className="vb-row-actions">
              <button type="button" className="vb-button vb-button-quiet" onClick={() => watermarkInputRef.current?.click()} disabled={isRunning}><Icon name="image" size={15} /> {watermarkImageName || 'Choose logo'}</button>
              {watermarkImageUrl && <button type="button" className="vb-text-button" onClick={() => { releaseUrl(watermarkImageUrl); setWatermarkImageUrl(null); setWatermarkImageName('') }} disabled={isRunning}>Remove logo</button>}
            </div>
            <div className="vb-control-grid">
              <label className="vb-form-field"><span>Opacity · {watermarkOpacity}%</span><input type="range" min="5" max="100" value={watermarkOpacity} onChange={(event) => setWatermarkOpacity(Number(event.target.value))} disabled={isRunning} /></label>
              <label className="vb-form-field"><span>Scale · {watermarkScale}%</span><input type="range" min="4" max="50" value={watermarkScale} onChange={(event) => setWatermarkScale(Number(event.target.value))} disabled={isRunning} /></label>
              <label className="vb-form-field"><span>Horizontal position</span><input type="range" min="4" max="96" value={watermarkX} onChange={(event) => setWatermarkX(Number(event.target.value))} disabled={isRunning} /></label>
              <label className="vb-form-field"><span>Vertical position</span><input type="range" min="4" max="96" value={watermarkY} onChange={(event) => setWatermarkY(Number(event.target.value))} disabled={isRunning} /></label>
            </div>
          </div>}

          {workspace === 'converter' && <div className="vb-panel-body">
            <p className="vb-panel-description">Rebuild every finished output into another format — on-device, nothing uploaded. The recorder format below is the base the converter starts from.</p>
            <div className="vb-form-field"><label htmlFor="vb-video-format">Video output</label>
              <select id="vb-video-format" className="vb-select" value={videoMime} onChange={(event) => setVideoMime(event.target.value as BatchSettings['videoMime'])} disabled={isRunning || !capabilities?.canRecordVideo}>
                <option value="auto">Automatic · browser preferred</option>
                {capabilities?.videoMimeTypes.some((mime) => mime.startsWith('video/webm')) && <option value="video/webm">WebM</option>}
                {capabilities?.videoMimeTypes.some((mime) => mime.startsWith('video/mp4')) && <option value="video/mp4">MP4 · browser encoded</option>}
              </select>
            </div>
            <div className="vb-form-field"><label htmlFor="vb-image-format">Image output</label>
              <select id="vb-image-format" className="vb-select" value={imageMime} onChange={(event) => setImageMime(event.target.value as BatchSettings['imageMime'])} disabled={isRunning}>
                {(capabilities?.imageMimeTypes ?? []).map((mime) => <option key={mime} value={mime}>{mime.replace('image/', '').toUpperCase()}</option>)}
              </select>
            </div>
            <div className="vb-form-field"><label htmlFor="vb-aspect">Frame aspect</label>
              <select id="vb-aspect" className="vb-select" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)} disabled={isRunning}>
                <option value="original">Preserve original</option><option value="portrait">Portrait · 9:16</option><option value="landscape">Landscape · 16:9</option><option value="square">Square · 1:1</option>
              </select>
            </div>
            <div className="vb-effect-section"><h3>Convert to</h3>
              <div className="vb-format-grid">
                {CONVERT_TARGETS.map((target) => {
                  const [headline, caption] = target.id === 'keep' ? ['As recorded', 'No conversion'] : (target.label.split(' · ') as [string, string?])
                  return (
                    <button key={target.id} type="button" className="vb-format-chip" data-on={converterSettings.target === target.id} onClick={() => updateConverter({ target: target.id })} disabled={isRunning}>
                      <strong>{headline}</strong>
                      <small>{caption ?? 'Browser encoded'}</small>
                    </button>
                  )
                })}
              </div>
              <p className="vb-quiet-note">How hard it compresses is set in the Compressor tab. The first conversion downloads the on-device engine once (~31 MB, then cached).</p>
            </div>
          </div>}

          {workspace === 'compressor' && <div className="vb-panel-body">
            <p className="vb-panel-description">Shrink finished outputs on-device. Lower levels re-encode harder — 100% keeps the recorded encode. Pick the target format in the Converter tab.</p>
            <div className="vb-effect-section"><h3>Compression level</h3>
              <div className="vb-preset-row">
                {COMPRESSION_PRESETS.map((preset) => (
                  <button key={preset.label} type="button" className="vb-preset-chip" data-on={converterSettings.quality === preset.quality} onClick={() => updateConverter({ quality: preset.quality })} disabled={isRunning}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="vb-form-field"><span>Fine tune · {converterSettings.quality}%</span><input type="range" min="35" max="100" step="1" value={converterSettings.quality} onChange={(event) => updateConverter({ quality: Number(event.target.value) })} disabled={isRunning} /></label>
            </div>
            <div className="vb-form-field"><label htmlFor="vb-resolution">Maximum resolution</label>
              <select id="vb-resolution" className="vb-select" value={resolution} onChange={(event) => setResolution(event.target.value as ResolutionCap)} disabled={isRunning}>
                <option value="original">Original · never upscale</option><option value="1080p">1080p · never upscale</option><option value="720p">720p · never upscale</option>
              </select>
            </div>
            <label className="vb-form-field"><span>Video bitrate · {videoBitrateMbps.toFixed(1)} Mbps</span><input type="range" min="0.5" max="20" step="0.5" value={videoBitrateMbps} onChange={(event) => setVideoBitrateMbps(Number(event.target.value))} disabled={isRunning} /></label>
            <label className="vb-form-field"><span>Image quality · {Math.round(imageQuality * 100)}%</span><input type="range" min="50" max="100" value={Math.round(imageQuality * 100)} onChange={(event) => setImageQuality(Number(event.target.value) / 100)} disabled={isRunning || imageMime === 'image/png'} /></label>
            <p className="vb-quiet-note">The resolution cap and bitrate apply while recording; the compression level re-encodes the finished file. Video uses a single browser task at a time, and large outputs stay in browser memory until downloaded.</p>
          </div>}

          {workspace === 'downloads' && <div className="vb-panel-body vb-downloads-panel">
            <div className="vb-downloads-head"><p>{readyJobs.length} ready <span>·</span> {fallbackJobs.length} fallback <span>·</span> {failedJobs.length} failed</p><button type="button" className="vb-text-button" onClick={clearDownloads} disabled={isRunning || (!readyJobs.length && !failedJobs.length)}>Clear finished</button></div>
            {jobs.length === 0 ? <div className="vb-empty-state"><span><Icon name="download" size={20} /></span><strong>No output files yet</strong><p>Generated media appears here after it passes output verification.</p></div> : (
              <div className="vb-job-list">
                {jobs.map((job) => <JobRow key={job.id} job={job} onDownload={() => downloadJob(job)} onRetry={() => retryJob(job)} onRemove={() => removeJob(job)} disabled={isRunning} />)}
              </div>
            )}
          </div>}
        </section>

        <aside className="vb-preview-column">
          <div className="vb-preview-head"><div><p className="vb-kicker">LIVE PREVIEW</p><strong>{activeMedia?.file.name ?? 'Choose a source'}</strong></div>
            {activeMedia && <span>{activeMedia.kind === 'video' ? 'VIDEO' : 'IMAGE'}</span>}
          </div>
          <div className={`vb-preview-stage ${activeMedia?.kind === 'image' ? 'is-image' : ''}`}>
            <div
              ref={stageRef}
              className="vb-preview-frame"
              style={activeMedia ? frameRatioStyle : { display: 'none' }}
            >
              {activeMedia && (activeMedia.kind === 'video' ? (
                <video key={activeMedia.url} ref={videoPreviewRef} src={activeMedia.url} controls playsInline preload="metadata" style={previewStyle} aria-label={`Preview of ${activeMedia.file.name}`} />
              ) : <img key={activeMedia.url} src={activeMedia.url} alt={`Preview of ${activeMedia.file.name}`} style={previewStyle} />)}
              {activeMedia && captionPool[0] && <div
                className={`vb-caption-preview ${workspace === 'captions' ? 'is-draggable' : ''}`}
                style={{ left: `${captionX}%`, top: `${captionY}%`, color: captionColor, fontSize: `${previewCaptionSize}px` }}
                onPointerDown={(event) => {
                  if (workspace !== 'captions') return
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setCaptionDrag(true)
                }}
                onPointerMove={updateCaptionPosition}
                onPointerUp={() => setCaptionDrag(false)}
                onPointerCancel={() => setCaptionDrag(false)}
                title={workspace === 'captions' ? 'Drag to reposition caption' : undefined}
              >{captionPool[0]}</div>}
              {activeMedia && (watermarkImageUrl || watermarkText.trim()) && <div className="vb-watermark-preview" style={{ left: `${watermarkX}%`, top: `${watermarkY}%`, opacity: watermarkOpacity / 100, width: `${watermarkScale}%` }}>
                {watermarkImageUrl ? <img src={watermarkImageUrl} alt="" /> : <span>{watermarkText}</span>}
              </div>}
            </div>
            {!activeMedia && <div className="vb-preview-placeholder"><Icon name="video" size={28} /><span>Preview appears after adding a file</span></div>}
          </div>
          <div className="vb-preview-meta">
            <span>{activeMedia ? formatBytes(activeMedia.file.size) : '—'}</span>
            <span>{activeMedia?.width && activeMedia.height ? `${activeMedia.width} × ${activeMedia.height}` : '—'}</span>
            <span>{activeMedia?.duration ? formatDuration(activeMedia.duration) : '—'}</span>
          </div>
          <div className="vb-preview-note">
            <span className="vb-note-mark"><Icon name="sliders" size={15} /></span>
            <p>{activeMedia ? 'Preview reflects the midpoint of enabled effect ranges. Each output uses its own seed.' : 'Add local video or image files to begin.'}</p>
          </div>
          {capabilities && <div className="vb-capability-line"><span>{capabilities.hardwareConcurrency} logical cores detected</span><span>·</span><span>Canvas 2D</span><span>·</span><span>GPU not used</span></div>}
        </aside>
      </div>

      <section className="vb-process-bar" aria-label="Batch processing">
        <div className="vb-process-config">
          <label><span>Variations</span><input type="number" min="1" max="100" value={variationCount} onChange={(event) => setVariationCount(numberValue(event, 1, 1, 100))} disabled={isRunning} /></label>
          <div className="vb-process-stat" title="Canvas renders are bounded in parallel; FFmpeg export passes remain serialized for stability."><span>Parallel renders</span><strong>Up to {plannedConcurrency}</strong></div>
          <div className="vb-process-stat"><span>Planned outputs</span><strong>{totalPlanned}</strong></div>
        </div>
        <div className="vb-progress-area">
          <div className="vb-progress-copy"><span>{batchMessage || (validFiles.length ? 'Ready to generate' : 'Add media to queue a batch')}</span><span>{isRunning ? `${Math.round(overallProgress * 100)}% · ${formatEta(startTimeRef.current, overallProgress)}` : `${completedJobs.length} clean · ${fallbackJobs.length} fallback · ${failedJobs.length} failed`}</span></div>
          <div className="vb-progress-track" role="progressbar" aria-valuenow={Math.round(overallProgress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(overallProgress * 100)}%` }} /></div>
        </div>
        <div className="vb-process-actions">
          {isRunning && <>
            <button type="button" className="vb-button vb-button-quiet" onClick={togglePause}><Icon name={isPaused ? 'play' : 'pause'} size={14} />{isPaused ? 'Resume' : 'Pause'}</button>
            <button type="button" className="vb-button vb-button-quiet" onClick={cancelBatch}><Icon name="stop" size={13} />Cancel</button>
          </>}
          <button type="button" className="vb-button vb-button-primary" onClick={startBatch} disabled={isRunning || isImporting || validFiles.length === 0 || Boolean(validationError)}>
            <Icon name="play" size={14} />{isRunning ? (isPaused ? 'Paused' : 'Generating…') : 'Generate variations'}
          </button>
        </div>
      </section>
      {validationError && <p className="vb-bottom-error" role="alert">{validationError}</p>}
    </div>
  )
}

function RangeControl({ definition, value, disabled, onChange }: {
  definition: (typeof EFFECT_DEFINITIONS)[number]
  value: EffectRange
  disabled: boolean
  onChange: (patch: Partial<EffectRange>) => void
}) {
  return (
    <div className="vb-range-row" data-disabled={!value.enabled}>
      <label className="vb-range-enable" title={`Enable ${definition.label} variation`}>
        <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} disabled={disabled} />
        <span />
      </label>
      <div className="vb-range-title"><strong>{definition.label}</strong><small>{definition.description}</small></div>
      <label className="vb-range-input"><span>MIN</span><input type="number" min={definition.min} max={definition.max} step={definition.step} value={value.min} onChange={(event) => onChange({ min: numberValue(event, value.min, definition.min, definition.max) })} disabled={disabled || !value.enabled} aria-label={`${definition.label} minimum`} /></label>
      <label className="vb-range-input"><span>MAX</span><input type="number" min={definition.min} max={definition.max} step={definition.step} value={value.max} onChange={(event) => onChange({ max: numberValue(event, value.max, definition.min, definition.max) })} disabled={disabled || !value.enabled} aria-label={`${definition.label} maximum`} /></label>
      <i className="vb-range-unit">{definition.unit || '—'}</i>
    </div>
  )
}

function AudioRange({ label, value, min, max, unit, disabled, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; disabled: boolean; onChange: (value: number) => void
}) {
  return <label className="vb-audio-range"><span>{label}</span><input type="range" min={min} max={max} step="0.5" value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} /><output>{value > 0 ? '+' : ''}{value} {unit}</output></label>
}

function JobRow({ job, onDownload, onRetry, onRemove, disabled }: { job: BatchJob; onDownload: () => void; onRetry: () => void; onRemove: () => void; disabled: boolean }) {
  const hasReadyOutput = job.status === 'completed' || job.status === 'fallback'
  return (
    <div className="vb-job-row" data-status={job.status}>
      <span className="vb-job-status" aria-label={job.status}><i /></span>
      <div className="vb-job-copy">
        <strong title={job.outputName ?? job.sourceName}>{job.outputName ?? job.sourceName}</strong>
        <small>{hasReadyOutput ? `${formatBytes(job.outputBytes ?? 0)} · ${mediaLabel(job.outputMime)} · ${formatDuration((job.elapsedMs ?? 0) / 1000)} render${job.status === 'fallback' ? ' · fallback — review warning' : ''}` : job.status === 'processing' ? `${job.phase ?? 'Rendering'} · ${Math.round(job.progress * 100)}%` : job.status === 'failed' ? job.error : `Variation ${job.variationIndex + 1} · ${job.status}`}</small>
        {job.error && job.status === 'failed' && <small className="vb-error-text">{job.error}</small>}
        {job.warnings.map((warning) => <small className="vb-warning-text" title={warning} key={warning}>{warning}</small>)}
      </div>
      {hasReadyOutput && <button type="button" className="vb-button vb-button-quiet vb-job-action" onClick={onDownload}><Icon name="download" size={14} />Download</button>}
      {(job.status === 'failed' || job.status === 'fallback') && <button type="button" className="vb-text-button" onClick={onRetry} disabled={disabled}>Retry</button>}
      {(hasReadyOutput || job.status === 'failed' || job.status === 'cancelled') && <button type="button" className="vb-icon-button" aria-label={`Remove ${job.outputName ?? job.sourceName}`} onClick={onRemove} disabled={disabled}><Icon name="x" size={14} /></button>}
    </div>
  )
}

function MetaSwitchCard({ label, description, on, disabled, onChange, children }: {
  label: string
  description: string
  on: boolean
  disabled: boolean
  onChange: (on: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="vb-meta-card" data-on={on}>
      <div className="vb-meta-card-head">
        <strong>{label}</strong>
        <span className="vb-meta-card-control">
          <span className="vb-meta-chip">{on ? 'Enabled' : 'Off'}</span>
          <label className="vb-switch" title={on ? `Turn ${label} off` : `Turn ${label} on`}>
            <input type="checkbox" checked={on} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
            <span aria-hidden />
          </label>
        </span>
      </div>
      <p>{description}</p>
      {children}
    </div>
  )
}

function imageTargetMime(target: ConvertTarget): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (target === 'jpg') return 'image/jpeg'
  if (target === 'png') return 'image/png'
  if (target === 'webp') return 'image/webp'
  return null
}

function mediaLabel(mime: string | null | undefined): string {
  if (!mime) return 'MEDIA'
  const known: Record<string, string> = {
    'video/mp4': 'MP4', 'video/webm': 'WEBM', 'video/x-matroska': 'MKV', 'video/quicktime': 'MOV',
    'image/gif': 'GIF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/avif': 'AVIF',
    'audio/mpeg': 'MP3', 'audio/mp4': 'M4A', 'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/webm': 'OPUS',
  }
  return known[mime] ?? mime.split('/').pop()?.toUpperCase() ?? 'MEDIA'
}

function numberValue(event: ChangeEvent<HTMLInputElement>, fallback: number, min: number, max: number): number {
  const value = Number(event.target.value)
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const remaining = whole % 60
  return minutes ? `${minutes}:${String(remaining).padStart(2, '0')}` : `${remaining}s`
}

function assertDurationWithinTolerance(expected: number | null, actual: number | null): void {
  if (expected === null || actual === null || !Number.isFinite(expected) || !Number.isFinite(actual)) return
  const tolerance = Math.max(0.5, expected * 0.08)
  if (Math.abs(expected - actual) > tolerance) {
    throw new Error(`The output duration changed from ${expected.toFixed(2)}s to ${actual.toFixed(2)}s (allowed difference ${tolerance.toFixed(2)}s).`)
  }
}

function formatEta(startTime: number | null, progress: number): string {
  if (!startTime || progress <= 0.01) return 'estimating'
  const elapsed = (performance.now() - startTime) / 1000
  const remaining = Math.max(0, elapsed / progress * (1 - progress))
  if (!Number.isFinite(remaining)) return 'estimating'
  return `${formatDuration(remaining)} left`
}

function waitMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
