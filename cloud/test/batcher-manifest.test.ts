// The batch plan: deterministic manifests and cheapest-operation planning.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest, computeCanvas, isNeutralVideo, outputNameFor, resolveVideo } from '../src/lib/batcher/manifest'
import { buildDefaultEffectSettings } from '../src/lib/batcher/effect-defs'
import { VariationRng } from '../src/lib/batcher/rng'
import type { EffectsConfig, MediaProbe, MetadataConfig, RenderConfig } from '../src/lib/batcher/types'

const probe: MediaProbe = {
  durationSeconds: 12,
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  audioChannels: 2,
  sampleRate: 48000,
  bitrate: 2_000_000,
  rotation: 0,
  fileSize: 3_000_000,
  hasVideo: true,
  hasAudio: true,
  source: 'mp4',
}

const effects = (): EffectsConfig => ({ settings: buildDefaultEffectSettings() })
const render: RenderConfig = { variations: 10, workers: 'auto', maxResolution: 'original', quality: 'balanced', seed: null }
const metadata: MetadataConfig = { stripGps: true, title: '', comment: '', variationTag: true }

function request(index: number) {
  return {
    batchId: 'batch-1',
    batchSeed: 424242,
    variationIndex: index,
    jobId: `job-${index}`,
    sourceId: 'src-1',
    sourceName: 'My Clip (final).mp4',
    probe,
    effects: effects(),
    render,
    metadata,
  }
}

test('canvas caps the shorter side and never upscales', () => {
  assert.deepEqual(computeCanvas(3840, 2160, '1080p'), { width: 1920, height: 1080 })
  assert.deepEqual(computeCanvas(1080, 1920, '1080p'), { width: 1080, height: 1920 })
  assert.deepEqual(computeCanvas(1440, 2560, '1080p'), { width: 1080, height: 1920 })
  assert.deepEqual(computeCanvas(1920, 1080, 'original'), { width: 1920, height: 1080 })
  const odd = computeCanvas(1081, 1921, '1080p')
  assert.equal(odd.width % 2, 0)
  assert.equal(odd.height % 2, 0)
})

test('output names are sanitized and indexed', () => {
  assert.equal(outputNameFor('My Clip (final).mp4', 16), 'My_Clip_final_v017.mp4')
  assert.equal(outputNameFor('clip', 0), 'clip_v001.mp4')
})

test('a manifest is reproducible from the same batch seed and index', () => {
  const a = buildManifest(request(9))
  const b = buildManifest(request(9))
  assert.deepEqual(a, b)
  const c = buildManifest(request(10))
  assert.notDeepEqual(a.video, c.video)
})

test('disabled effects resolve to neutral values', () => {
  const config = effects()
  for (const setting of config.settings) setting.enabled = false
  const rng = new VariationRng(7n, 3)
  const video = resolveVideo(rng, config, probe)
  assert.equal(video.brightness, 0)
  assert.equal(video.contrast, 0)
  assert.equal(video.gamma, 1)
  assert.equal(video.speed, 1)
  assert.equal(video.zoom, 1)
  assert.equal(video.mirror, null)
  assert.equal(video.cutEndSeconds, null)
})

test('neutral video at native resolution plans a stream copy', () => {
  const config = effects()
  for (const setting of config.settings) setting.enabled = false
  const manifest = buildManifest({ ...request(0), effects: config })
  assert.equal(manifest.streamCopy, true)
  assert.equal(manifest.export.audioCodec, 'copy')
  assert.equal(isNeutralVideo(manifest.video, probe, { width: 1080, height: 1920 }), true)
})

test('any enabled effect breaks the copy plan', () => {
  const manifest = buildManifest(request(0))
  assert.equal(manifest.streamCopy, false)
})

test('resolution cap breaks the copy plan even with neutral effects', () => {
  const config = effects()
  for (const setting of config.settings) setting.enabled = false
  const manifest = buildManifest({
    ...request(0),
    effects: config,
    render: { ...render, maxResolution: '720p' },
  })
  assert.equal(manifest.streamCopy, false)
  assert.deepEqual([manifest.export.canvasWidth, manifest.export.canvasHeight], [720, 1280])
})

test('cut end trims seconds off the tail, never past the head', () => {
  const config = effects()
  for (const setting of config.settings) setting.enabled = false
  const cut = config.settings.find((setting) => setting.id === 'cutEnd')
  assert.ok(cut)
  cut.enabled = true
  cut.min = 2
  cut.max = 2
  const video = resolveVideo(new VariationRng(3n, 0), config, probe)
  assert.equal(video.cutEndSeconds, 10)

  const long = { ...cut, min: 14, max: 14 }
  const aggressive = { settings: config.settings.map((setting) => (setting.id === 'cutEnd' ? long : setting)) }
  assert.equal(resolveVideo(new VariationRng(3n, 0), aggressive, probe).cutEndSeconds, null)
})
