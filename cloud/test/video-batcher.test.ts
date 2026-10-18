import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONVERT_TARGETS,
  DEFAULT_CONVERTER_SETTINGS,
  DEFAULT_EFFECT_RANGES,
  DEFAULT_METADATA_SETTINGS,
  computeCropRect,
  computeOutputSize,
  createSeededRandom,
  renderConcurrencyLimit,
  formatOutputName,
  resolveTrim,
  resolveVariation,
  serializePreset,
  validateAiSuggestion,
  validateConverterSettings,
  validateEffectRanges,
  validateMetadataSettings,
  validatePreset,
  type VideoBatcherPreset,
} from '../src/lib/video-batcher'
import { hasExpectedSignature } from '../src/lib/video-batcher-ffmpeg'

function preset(): VideoBatcherPreset {
  return {
    schemaVersion: 1,
    name: 'Portrait export',
    settings: {
      effects: structuredClone(DEFAULT_EFFECT_RANGES),
      variations: 4,
      batchSeed: 123456,
      videoMime: 'auto',
      imageMime: 'image/webp',
      imageQuality: 0.88,
      flipHorizontal: false,
      flipVertical: false,
      aspectRatio: 'portrait',
      resolution: '1080p',
      videoBitrateMbps: 6,
      genericOutputNames: false,
      captionText: 'One line\nSecond line',
      captionSize: 48,
      captionColor: '#ffffff',
      captionX: 50,
      captionY: 82,
      audioMuted: false,
      audioVolumeDb: 0,
      audioFadeIn: 0,
      audioFadeOut: 0,
      audioEqLow: 0,
      audioEqMid: 0,
      audioEqHigh: 0,
      watermarkText: '',
      watermarkOpacity: 76,
      watermarkScale: 18,
      watermarkX: 88,
      watermarkY: 88,
    },
  }
}

test('seeded RNG and variation resolution are reproducible', () => {
  const firstRandom = createSeededRandom(987_654)
  const secondRandom = createSeededRandom(987_654)
  assert.deepEqual(Array.from({ length: 8 }, firstRandom), Array.from({ length: 8 }, secondRandom))

  const first = resolveVariation(DEFAULT_EFFECT_RANGES, 1234, 2, 5, 4)
  const repeated = resolveVariation(DEFAULT_EFFECT_RANGES, 1234, 2, 5, 4)
  const next = resolveVariation(DEFAULT_EFFECT_RANGES, 1234, 2, 6, 4)
  assert.deepEqual(first, repeated)
  assert.notEqual(first.seed, next.seed)
  assert.notEqual(first.captionIndex, null)
})

test('disabled ranges stay neutral and equal endpoints are fixed values', () => {
  const ranges = structuredClone(DEFAULT_EFFECT_RANGES)
  ranges.brightness = { enabled: false, min: -8, max: 8 }
  ranges.zoom = { enabled: true, min: 1.04, max: 1.04 }
  const result = resolveVariation(ranges, 7, 0, 0)
  assert.equal(result.effects.brightness, 0)
  assert.equal(result.effects.zoom, 1.04)
})

test('effect validation rejects inverted and out-of-bounds ranges', () => {
  const ranges = structuredClone(DEFAULT_EFFECT_RANGES)
  ranges.speed = { enabled: true, min: 1.2, max: 1.1 }
  assert.match(validateEffectRanges(ranges) ?? '', /minimum must not exceed maximum/)
  ranges.speed = { enabled: true, min: 0.1, max: 1 }
  assert.match(validateEffectRanges(ranges) ?? '', /must stay between/)
  ranges.speed = { enabled: false, min: 1, max: 1 }
  assert.equal(validateEffectRanges(ranges), null)
})

test('trim boundaries stay inside the source and retain at least 100 ms', () => {
  assert.deepEqual(resolveTrim(10, 2, 3), { start: 2, end: 7 })
  assert.deepEqual(resolveTrim(10, 80, 0), { start: 9.9, end: 10 })
  assert.throws(() => resolveTrim(0, 0, 0), /duration/)
})

test('aspect crops preserve the requested ratio and output caps never upscale', () => {
  const portraitCrop = computeCropRect(1920, 1080, 'portrait')
  assert.ok(Math.abs(portraitCrop.width / portraitCrop.height - 9 / 16) < 0.002)
  assert.ok(Math.abs((portraitCrop.x * 2 + portraitCrop.width) - 1920) <= 1)

  const output = computeOutputSize(3840, 2160, 'original', '1080p')
  assert.deepEqual({ width: output.width, height: output.height }, { width: 1920, height: 1080 })
  const small = computeOutputSize(640, 360, 'original', '720p')
  assert.deepEqual({ width: small.width, height: small.height }, { width: 640, height: 360 })
})

test('output names are sanitized, indexed and distinguish batch runs', () => {
  const first = formatOutputName('My vacation (final).mp4', 0, 1984, 'webm', 'run-aaaabbbb')
  const second = formatOutputName('My vacation (final).mp4', 1, 1985, '.webm', 'run-ccccdddd')
  assert.match(first, /^My-vacation-final_v001_[a-z0-9]+_runaaaabbbb\.webm$/)
  assert.notEqual(first, second)
})

test('preset serialization round-trips a versioned full settings object', () => {
  const original = preset()
  const encoded = serializePreset(original)
  const decoded = validatePreset(JSON.parse(encoded))
  assert.deepEqual(decoded, original)
  assert.equal(validatePreset({ ...original, schemaVersion: 99 }), null)
  assert.equal(validatePreset({ ...original, settings: { ...original.settings, variations: 0 } }), null)
})

test('metadata and converter settings validate, sanitize, and round-trip in presets', () => {
  assert.deepEqual(validateMetadataSettings(structuredClone(DEFAULT_METADATA_SETTINGS)), DEFAULT_METADATA_SETTINGS)
  assert.equal(validateMetadataSettings({ ...structuredClone(DEFAULT_METADATA_SETTINGS), gps: 'yes' }), null)
  assert.equal(validateMetadataSettings({ ...structuredClone(DEFAULT_METADATA_SETTINGS), encoderTag: 'x'.repeat(200) }), null)
  assert.equal(validateMetadataSettings(null), null)

  assert.deepEqual(validateConverterSettings(structuredClone(DEFAULT_CONVERTER_SETTINGS)), DEFAULT_CONVERTER_SETTINGS)
  assert.equal(validateConverterSettings({ target: 'avi', quality: 80 }), null)
  assert.equal(validateConverterSettings({ target: 'mp4', quality: 5 }), null)
  assert.equal(validateConverterSettings({ target: 'mp4', quality: 76.6 })?.quality, 77)
  assert.ok(CONVERT_TARGETS.some((target) => target.id === 'gif'))

  const original = preset()
  original.settings.metadata = { ...structuredClone(DEFAULT_METADATA_SETTINGS), title: true, encoderTag: 'My Studio' }
  original.settings.converter = { target: 'mp4', quality: 82 }
  const decoded = validatePreset(JSON.parse(serializePreset(original)))
  assert.deepEqual(decoded?.settings.metadata, original.settings.metadata)
  assert.deepEqual(decoded?.settings.converter, original.settings.converter)

  const legacy = preset()
  const legacyDecoded = validatePreset(JSON.parse(serializePreset(legacy)))
  assert.equal(legacyDecoded?.settings.metadata, undefined)
  assert.equal(legacyDecoded?.settings.converter, undefined)
})

test('converted output signatures must agree with the requested container', () => {
  const bytes = (value: string) => new TextEncoder().encode(value)
  const concat = (...parts: Uint8Array[]) => {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) { output.set(part, offset); offset += part.length }
    return output
  }
  assert.equal(hasExpectedSignature(bytes('RIFF0000WEBP'), 'webp'), true)
  assert.equal(hasExpectedSignature(bytes('GIF89a'), 'gif'), true)
  assert.equal(hasExpectedSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'), true)
  assert.equal(hasExpectedSignature(bytes('RIFF0000WAVE'), 'wav'), true)
  assert.equal(hasExpectedSignature(bytes('ID3'), 'mp3'), true)
  assert.equal(hasExpectedSignature(bytes('\x00\x00\x00\x18ftypisom'), 'mp4'), true)
  assert.equal(hasExpectedSignature(bytes('\x00\x00\x00\x18ftypqt  '), 'mov'), true)
  const ebml = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00])
  assert.equal(hasExpectedSignature(concat(ebml, bytes('webm')), 'webm'), true)
  assert.equal(hasExpectedSignature(concat(ebml, bytes('matroska')), 'mkv'), true)
  assert.equal(hasExpectedSignature(bytes('RIFF0000WEBP'), 'jpg'), false)
})

test('render concurrency stays bounded by media cost and device cores', () => {
  assert.equal(renderConcurrencyLimit([], 12), 0)
  assert.equal(renderConcurrencyLimit(['image'], 12), 4)
  assert.equal(renderConcurrencyLimit(['image'], 4), 2)
  assert.equal(renderConcurrencyLimit(['video'], 12), 2)
  assert.equal(renderConcurrencyLimit(['video'], 4), 1)
  assert.equal(renderConcurrencyLimit(['image', 'video'], 12), 2)
  assert.equal(renderConcurrencyLimit(['image'], Number.NaN), 1)
})

test('AI suggestions are accepted only within supported controls and ranges', () => {
  assert.deepEqual(validateAiSuggestion({
    variations: 12,
    videoFormat: 'webm',
    aspectRatio: 'portrait',
    resolution: '1080p',
    effects: { zoom: { enabled: true, min: 1.01, max: 1.05 } },
  }), {
    variations: 12,
    videoFormat: 'webm',
    aspectRatio: 'portrait',
    resolution: '1080p',
    effects: { zoom: { enabled: true, min: 1.01, max: 1.05 } },
  })
  assert.equal(validateAiSuggestion({ variations: 1000 }), null)
  assert.equal(validateAiSuggestion({ effects: { zoom: { enabled: true, min: 0.5, max: 1.1 } } }), null)
  assert.equal(validateAiSuggestion({ effects: { metadata: { enabled: true, min: 0, max: 1 } } }), null)
})
