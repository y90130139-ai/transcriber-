export type EffectKey =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'hue'
  | 'zoom'
  | 'rotation'
  | 'shiftX'
  | 'shiftY'
  | 'speed'
  | 'trimStart'
  | 'trimEnd'

export interface EffectRange {
  enabled: boolean
  min: number
  max: number
}

export type EffectRanges = Record<EffectKey, EffectRange>

export interface EffectDefinition {
  key: EffectKey
  label: string
  description: string
  unit: string
  min: number
  max: number
  step: number
  neutral: number
  initial: EffectRange
}

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  { key: 'brightness', label: 'Brightness', description: 'Luminance shift', unit: '%', min: -50, max: 50, step: 1, neutral: 0, initial: { enabled: true, min: -3, max: 3 } },
  { key: 'contrast', label: 'Contrast', description: 'Tonal separation', unit: '%', min: -50, max: 100, step: 1, neutral: 0, initial: { enabled: true, min: -3, max: 3 } },
  { key: 'saturation', label: 'Saturation', description: 'Color intensity', unit: '%', min: -100, max: 100, step: 1, neutral: 0, initial: { enabled: true, min: -4, max: 4 } },
  { key: 'hue', label: 'Hue', description: 'Hue rotation', unit: '°', min: -180, max: 180, step: 1, neutral: 0, initial: { enabled: false, min: -2, max: 2 } },
  { key: 'zoom', label: 'Zoom', description: 'Scale factor', unit: '×', min: 1, max: 2, step: 0.01, neutral: 1, initial: { enabled: true, min: 1, max: 1.03 } },
  { key: 'rotation', label: 'Rotation', description: 'Frame rotation', unit: '°', min: -45, max: 45, step: 0.1, neutral: 0, initial: { enabled: false, min: -1, max: 1 } },
  { key: 'shiftX', label: 'Horizontal shift', description: 'Frame offset', unit: '%', min: -25, max: 25, step: 0.1, neutral: 0, initial: { enabled: false, min: -1, max: 1 } },
  { key: 'shiftY', label: 'Vertical shift', description: 'Frame offset', unit: '%', min: -25, max: 25, step: 0.1, neutral: 0, initial: { enabled: false, min: -1, max: 1 } },
  { key: 'speed', label: 'Playback speed', description: 'Video and audio stay in sync', unit: '×', min: 0.25, max: 4, step: 0.05, neutral: 1, initial: { enabled: false, min: 0.98, max: 1.02 } },
  { key: 'trimStart', label: 'Trim from start', description: 'Seconds removed from the start', unit: 's', min: 0, max: 600, step: 0.1, neutral: 0, initial: { enabled: false, min: 0, max: 0 } },
  { key: 'trimEnd', label: 'Trim from end', description: 'Seconds removed from the end', unit: 's', min: 0, max: 600, step: 0.1, neutral: 0, initial: { enabled: false, min: 0, max: 0 } },
]

export const DEFAULT_EFFECT_RANGES = Object.fromEntries(
  EFFECT_DEFINITIONS.map(({ key, initial }) => [key, { ...initial }]),
) as EffectRanges

export interface ResolvedVariation {
  seed: number
  effects: Record<EffectKey, number>
  captionIndex: number | null
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type AspectRatio = 'original' | 'portrait' | 'landscape' | 'square'
export type ResolutionCap = 'original' | '1080p' | '720p'

/** Metadata work applied to every finished output (Geno, 2026-10-12).
 *  Randomization is deterministic from the batch/variation seed, so the same
 *  batch always produces the same tags; privacy flags guarantee stripping. */
export interface MetadataSettings {
  variationTag: boolean
  creationTime: boolean
  comments: boolean
  title: boolean
  encoderParams: boolean
  encoderTagEnabled: boolean
  encoderTag: string
  gps: boolean
  sourceTags: boolean
  cleanExport: boolean
}

export type ConvertTarget = 'keep' | 'mp4' | 'webm' | 'mkv' | 'mov' | 'gif' | 'mp3' | 'm4a' | 'wav' | 'jpg' | 'png' | 'webp'

/** The converter & compressor: target container plus a quality lever that
 *  maps to CRF when the on-device encoder re-encodes. */
export interface ConverterSettings {
  target: ConvertTarget
  quality: number
}

export const DEFAULT_METADATA_SETTINGS: MetadataSettings = {
  variationTag: true,
  creationTime: false,
  comments: false,
  title: false,
  encoderParams: false,
  encoderTagEnabled: true,
  encoderTag: 'Video Batcher Studio',
  gps: true,
  sourceTags: false,
  cleanExport: false,
}

export const DEFAULT_CONVERTER_SETTINGS: ConverterSettings = { target: 'keep', quality: 100 }

/** The three compression levels the Compressor tool offers, per the usual
 *  converter convention (clarity ↔ smallest). */
export const COMPRESSION_PRESETS: { label: string; quality: number }[] = [
  { label: 'Clarity', quality: 100 },
  { label: 'Balanced', quality: 75 },
  { label: 'Smallest', quality: 55 },
]

export const CONVERT_TARGETS: { id: ConvertTarget; label: string }[] = [
  { id: 'keep', label: 'Keep the recorded format' },
  { id: 'mp4', label: 'MP4 · H.264' },
  { id: 'webm', label: 'WebM · VP8' },
  { id: 'mkv', label: 'MKV · H.264' },
  { id: 'mov', label: 'MOV · H.264' },
  { id: 'gif', label: 'GIF · animated' },
  { id: 'mp3', label: 'MP3 · audio only' },
  { id: 'm4a', label: 'M4A · audio only' },
  { id: 'wav', label: 'WAV · audio only' },
  { id: 'jpg', label: 'JPG · still' },
  { id: 'png', label: 'PNG · still' },
  { id: 'webp', label: 'WebP · still' },
]

/** Render independent jobs concurrently without changing any output settings.
 *  Video playback/recording is more memory-heavy, so use two slots on machines
 *  with at least six logical cores and one on smaller devices. Still images
 *  are cheaper and may use up to four slots. */
export function renderConcurrencyLimit(mediaKinds: readonly ('image' | 'video')[], hardwareConcurrency: number): number {
  if (!mediaKinds.length) return 0
  const cores = Number.isFinite(hardwareConcurrency) ? Math.max(1, Math.floor(hardwareConcurrency)) : 2
  if (mediaKinds.includes('video')) return cores >= 6 ? 2 : 1
  return cores >= 8 ? 4 : Math.max(1, Math.floor(cores / 2))
}

type MetadataBooleanKey = 'variationTag' | 'creationTime' | 'comments' | 'title' | 'encoderParams' | 'encoderTagEnabled' | 'gps' | 'sourceTags' | 'cleanExport'

const METADATA_BOOLEAN_KEYS: MetadataBooleanKey[] = [
  'variationTag', 'creationTime', 'comments', 'title', 'encoderParams', 'encoderTagEnabled', 'gps', 'sourceTags', 'cleanExport',
]

export function validateMetadataSettings(value: unknown): MetadataSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (METADATA_BOOLEAN_KEYS.some((key) => typeof candidate[key] !== 'boolean')) return null
  if (typeof candidate.encoderTag !== 'string' || candidate.encoderTag.length > 120) return null
  const output = {} as MetadataSettings
  for (const key of METADATA_BOOLEAN_KEYS) output[key] = candidate[key] as boolean
  output.encoderTag = candidate.encoderTag.trim().slice(0, 80)
  return output
}

export function validateConverterSettings(value: unknown): ConverterSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!CONVERT_TARGETS.some((target) => target.id === candidate.target)) return null
  if (typeof candidate.quality !== 'number' || !Number.isFinite(candidate.quality) || candidate.quality < 35 || candidate.quality > 100) return null
  return { target: candidate.target as ConvertTarget, quality: Math.round(candidate.quality) }
}

export interface VideoBatcherPreset {
  schemaVersion: 1
  name: string
  settings: {
    effects: EffectRanges
    variations: number
    batchSeed: number
    videoMime: 'auto' | 'video/webm' | 'video/mp4'
    imageMime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'
    imageQuality: number
    flipHorizontal: boolean
    flipVertical: boolean
    aspectRatio: AspectRatio
    resolution: ResolutionCap
    videoBitrateMbps: number
    genericOutputNames: boolean
    captionText: string
    captionSize: number
    captionColor: string
    captionX: number
    captionY: number
    audioMuted: boolean
    audioVolumeDb: number
    audioFadeIn: number
    audioFadeOut: number
    audioEqLow: number
    audioEqMid: number
    audioEqHigh: number
    watermarkText: string
    watermarkOpacity: number
    watermarkScale: number
    watermarkX: number
    watermarkY: number
    metadata?: MetadataSettings
    converter?: ConverterSettings
  }
}

export interface AiBatcherSuggestion {
  variations?: number
  videoFormat?: 'auto' | 'webm' | 'mp4'
  aspectRatio?: AspectRatio
  resolution?: ResolutionCap
  effects?: Partial<Record<EffectKey, { enabled: boolean; min: number; max: number }>>
}

const DEFINITION_BY_KEY = Object.fromEntries(
  EFFECT_DEFINITIONS.map((definition) => [definition.key, definition]),
) as Record<EffectKey, EffectDefinition>

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

export function deriveVariationSeed(batchSeed: number, sourceIndex: number, variationIndex: number): number {
  const input = `${batchSeed >>> 0}:${sourceIndex >>> 0}:${variationIndex >>> 0}`
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function resolveVariation(
  ranges: EffectRanges,
  batchSeed: number,
  sourceIndex: number,
  variationIndex: number,
  captionCount = 0,
): ResolvedVariation {
  const seed = deriveVariationSeed(batchSeed, sourceIndex, variationIndex)
  const random = createSeededRandom(seed)
  const effects = {} as Record<EffectKey, number>

  for (const { key, neutral } of EFFECT_DEFINITIONS) {
    const range = ranges[key]
    if (!range.enabled) {
      effects[key] = neutral
      continue
    }
    if (range.min === range.max) {
      effects[key] = range.min
      continue
    }
    effects[key] = range.min + random() * (range.max - range.min)
  }

  return {
    seed,
    effects,
    captionIndex: captionCount > 0 ? Math.floor(random() * captionCount) : null,
  }
}

export function validateEffectRanges(ranges: EffectRanges): string | null {
  for (const definition of EFFECT_DEFINITIONS) {
    const range = ranges[definition.key]
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      return `${definition.label} values must be valid numbers.`
    }
    if (range.min > range.max) return `${definition.label}: minimum must not exceed maximum.`
    if (range.min < definition.min || range.max > definition.max) {
      return `${definition.label} must stay between ${definition.min}${definition.unit} and ${definition.max}${definition.unit}.`
    }
  }
  return null
}

export function resolveTrim(duration: number, trimStart: number, trimEnd: number): { start: number; end: number } {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source duration could not be read.')
  const start = Math.max(0, Math.min(trimStart, duration - 0.1))
  const end = Math.min(duration, Math.max(start + 0.1, duration - Math.max(0, trimEnd)))
  if (end - start < 0.1 - 1e-9) throw new Error('Trimming must leave at least 0.1 seconds of media.')
  return { start, end }
}

export function computeCropRect(width: number, height: number, aspect: AspectRatio): CropRect {
  const sourceWidth = Math.max(1, width)
  const sourceHeight = Math.max(1, height)
  if (aspect === 'original') return { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  const ratio = aspect === 'portrait' ? 9 / 16 : aspect === 'landscape' ? 16 / 9 : 1
  const sourceRatio = sourceWidth / sourceHeight
  if (Math.abs(sourceRatio - ratio) / ratio < 0.005) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  }
  if (sourceRatio > ratio) {
    const cropWidth = Math.max(1, Math.floor(sourceHeight * ratio))
    return { x: Math.floor((sourceWidth - cropWidth) / 2), y: 0, width: cropWidth, height: sourceHeight }
  }
  const cropHeight = Math.max(1, Math.floor(sourceWidth / ratio))
  return { x: 0, y: Math.floor((sourceHeight - cropHeight) / 2), width: sourceWidth, height: cropHeight }
}

export function computeOutputSize(
  width: number,
  height: number,
  aspect: AspectRatio,
  cap: ResolutionCap,
  forVideo = true,
): { width: number; height: number; crop: CropRect } {
  const crop = computeCropRect(width, height, aspect)
  const capSide = cap === '1080p' ? 1080 : cap === '720p' ? 720 : Infinity
  const shorterSide = Math.min(crop.width, crop.height)
  const scale = Math.min(1, capSide / shorterSide)
  const makeEven = (value: number) => {
    const rounded = Math.max(1, Math.round(value))
    return forVideo && rounded > 1 ? rounded - (rounded % 2) : rounded
  }
  return { width: makeEven(crop.width * scale), height: makeEven(crop.height * scale), crop }
}

export function formatOutputName(sourceName: string, variationIndex: number, seed: number, extension: string, runId: string): string {
  const stem = sourceName
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'media'
  const index = String(variationIndex + 1).padStart(3, '0')
  const seedTag = (seed >>> 0).toString(36).slice(-5)
  const runTag = runId.replace(/[^a-z0-9]/gi, '').slice(-12) || 'batch'
  return `${stem}_v${index}_${seedTag}_${runTag}.${extension.replace(/^\./, '')}`
}

export function validatePreset(value: unknown): VideoBatcherPreset | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<VideoBatcherPreset>
  if (candidate.schemaVersion !== 1 || typeof candidate.name !== 'string' || !candidate.settings || typeof candidate.settings !== 'object') return null
  const settings = candidate.settings as VideoBatcherPreset['settings']
  if (!settings.effects || validateEffectRanges(settings.effects) !== null) return null
  if (!Number.isInteger(settings.variations) || settings.variations < 1 || settings.variations > 100) return null
  if (!Number.isInteger(settings.batchSeed) || settings.batchSeed < 0 || settings.batchSeed > 0xffff_ffff) return null
  if (!['auto', 'video/webm', 'video/mp4'].includes(settings.videoMime)) return null
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(settings.imageMime)) return null
  if (!Number.isFinite(settings.imageQuality) || settings.imageQuality < 0.5 || settings.imageQuality > 1) return null
  if (!['original', 'portrait', 'landscape', 'square'].includes(settings.aspectRatio)) return null
  if (!['original', '1080p', '720p'].includes(settings.resolution)) return null
  if (!Number.isFinite(settings.videoBitrateMbps) || settings.videoBitrateMbps < 0.5 || settings.videoBitrateMbps > 25) return null
  const numericFields: (keyof VideoBatcherPreset['settings'])[] = [
    'captionSize', 'captionX', 'captionY', 'audioVolumeDb', 'audioFadeIn', 'audioFadeOut',
    'audioEqLow', 'audioEqMid', 'audioEqHigh', 'watermarkOpacity', 'watermarkScale', 'watermarkX', 'watermarkY',
  ]
  if (numericFields.some((field) => !Number.isFinite(settings[field]))) return null
  if (settings.captionSize < 12 || settings.captionSize > 160 || settings.captionX < 4 || settings.captionX > 96 || settings.captionY < 4 || settings.captionY > 96) return null
  if (settings.audioVolumeDb < -24 || settings.audioVolumeDb > 12 || settings.audioFadeIn < 0 || settings.audioFadeIn > 30 || settings.audioFadeOut < 0 || settings.audioFadeOut > 30) return null
  if (settings.audioEqLow < -12 || settings.audioEqLow > 12 || settings.audioEqMid < -12 || settings.audioEqMid > 12 || settings.audioEqHigh < -12 || settings.audioEqHigh > 12) return null
  if (settings.watermarkOpacity < 5 || settings.watermarkOpacity > 100 || settings.watermarkScale < 4 || settings.watermarkScale > 50 || settings.watermarkX < 4 || settings.watermarkX > 96 || settings.watermarkY < 4 || settings.watermarkY > 96) return null
  if (typeof settings.flipHorizontal !== 'boolean' || typeof settings.flipVertical !== 'boolean' || typeof settings.genericOutputNames !== 'boolean' || typeof settings.captionText !== 'string' || settings.captionText.length > 12_000 || typeof settings.captionColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(settings.captionColor) || typeof settings.audioMuted !== 'boolean' || typeof settings.watermarkText !== 'string') return null
  const checkedMetadata = settings.metadata === undefined ? undefined : validateMetadataSettings(settings.metadata)
  if (settings.metadata !== undefined && !checkedMetadata) return null
  const checkedConverter = settings.converter === undefined ? undefined : validateConverterSettings(settings.converter)
  if (settings.converter !== undefined && !checkedConverter) return null
  return {
    schemaVersion: 1,
    name: candidate.name.trim().slice(0, 60) || 'Imported preset',
    settings: {
      ...settings,
      ...(checkedMetadata ? { metadata: checkedMetadata } : {}),
      ...(checkedConverter ? { converter: checkedConverter } : {}),
    },
  }
}

export function validateAiSuggestion(value: unknown): AiBatcherSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const suggestion: AiBatcherSuggestion = {}
  if ('variations' in candidate) {
    if (!Number.isInteger(candidate.variations) || Number(candidate.variations) < 1 || Number(candidate.variations) > 100) return null
    suggestion.variations = Number(candidate.variations)
  }
  if ('videoFormat' in candidate) {
    if (!['auto', 'webm', 'mp4'].includes(String(candidate.videoFormat))) return null
    suggestion.videoFormat = candidate.videoFormat as AiBatcherSuggestion['videoFormat']
  }
  if ('aspectRatio' in candidate) {
    if (!['original', 'portrait', 'landscape', 'square'].includes(String(candidate.aspectRatio))) return null
    suggestion.aspectRatio = candidate.aspectRatio as AspectRatio
  }
  if ('resolution' in candidate) {
    if (!['original', '1080p', '720p'].includes(String(candidate.resolution))) return null
    suggestion.resolution = candidate.resolution as ResolutionCap
  }
  if ('effects' in candidate) {
    if (!candidate.effects || typeof candidate.effects !== 'object' || Array.isArray(candidate.effects)) return null
    const output: NonNullable<AiBatcherSuggestion['effects']> = {}
    for (const [key, raw] of Object.entries(candidate.effects)) {
      if (!(key in DEFINITION_BY_KEY) || !raw || typeof raw !== 'object') return null
      const item = raw as Record<string, unknown>
      const definition = DEFINITION_BY_KEY[key as EffectKey]
      if (typeof item.enabled !== 'boolean' || typeof item.min !== 'number' || typeof item.max !== 'number') return null
      if (!Number.isFinite(item.min) || !Number.isFinite(item.max) || item.min > item.max || item.min < definition.min || item.max > definition.max) return null
      output[key as EffectKey] = { enabled: item.enabled, min: item.min, max: item.max }
    }
    suggestion.effects = output
  }
  return Object.keys(suggestion).length > 0 ? suggestion : null
}

export function serializePreset(preset: VideoBatcherPreset): string {
  const valid = validatePreset(preset)
  if (!valid) throw new Error('The preset settings are invalid.')
  return JSON.stringify(valid, null, 2)
}
