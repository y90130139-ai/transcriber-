// The command builder: one decode, one encode, one graph — and copy when nothing needs changing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atempoChain, buildFfmpegArgs, buildVideoChain } from '../src/lib/batcher/ffargs'
import { buildManifest } from '../src/lib/batcher/manifest'
import { buildDefaultEffectSettings } from '../src/lib/batcher/effect-defs'
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

const render: RenderConfig = { variations: 10, workers: 'auto', maxResolution: 'original', quality: 'balanced', seed: null }
const metadata: MetadataConfig = { stripGps: true, title: '', comment: '', variationTag: true }

function manifestFor(configure: (effects: EffectsConfig) => void) {
  const effects: EffectsConfig = { settings: buildDefaultEffectSettings() }
  configure(effects)
  return buildManifest({
    batchId: 'batch-1',
    batchSeed: 777,
    variationIndex: 0,
    jobId: 'job-0',
    sourceId: 'src-1',
    sourceName: 'clip.mp4',
    probe,
    effects,
    render,
    metadata,
  })
}

function neutral() {
  return manifestFor((effects) => {
    for (const setting of effects.settings) setting.enabled = false
  })
}

test('every enabled effect lands in one filter_complex and one encoder', () => {
  const manifest = manifestFor(() => {})
  // Pin values so the assertions below are about the graph, not the sample.
  manifest.video = {
    ...manifest.video,
    brightness: 2,
    contrast: 3,
    saturation: -4,
    hueDegrees: 1,
    temperature: 120,
    gamma: 1.01,
    zoom: 1.02,
    shiftXPercent: 1,
    shiftYPercent: -1,
    rotationDegrees: 0.4,
    speed: 1.01,
    sharpen: 0.3,
    noise: 2,
  }
  const args = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  const graph = args[args.indexOf('-filter_complex') + 1]

  assert.ok(graph.includes('eq='))
  assert.ok(graph.includes('hue='))
  assert.ok(graph.includes('colorchannelmixer='))
  assert.ok(graph.includes('rotate='))
  assert.ok(graph.includes('setpts='))
  assert.ok(graph.includes('unsharp='))
  assert.ok(graph.includes('noise='))
  // One video output, one video encode.
  assert.deepEqual(args.filter((value) => value === '-c:v'), ['-c:v'])
  assert.deepEqual(args.filter((value) => value === '-filter_complex'), ['-filter_complex'])
  assert.ok(args.includes('[vout]'))
})

test('neutral settings skip every costly filter but keep the scale pass', () => {
  const chain = buildVideoChain(neutral())
  assert.equal(chain, 'scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p')
})

test('speed drives both setpts and atempo in one chain', () => {
  const manifest = manifestFor((effects) => {
    for (const setting of effects.settings) setting.enabled = false
    const speed = effects.settings.find((setting) => setting.id === 'speed')
    assert.ok(speed)
    speed.enabled = true
    speed.min = 1.25
    speed.max = 1.25
  })
  const args = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.ok(graph.includes('setpts=PTS/1.25'))
  assert.ok(graph.includes('atempo=1.25'))
  assert.ok(args.includes('[aout]'))
})

test('atempo chains around the single-instance limits', () => {
  assert.equal(atempoChain(2), 'atempo=2.000000')
  assert.ok(atempoChain(4).startsWith('atempo=2.0,'))
  assert.ok(atempoChain(0.25).startsWith('atempo=0.5,'))
})

test('a fully neutral plan is a remux, not a re-encode', () => {
  const manifest = neutral()
  const args = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  assert.ok(!args.includes('-filter_complex'))
  assert.deepEqual(args.filter((value) => value === 'copy'), ['copy', 'copy'])
  assert.ok(args.includes('+faststart'))
})

test('speed changes force audio through aac instead of copy', () => {
  const manifest = manifestFor((effects) => {
    for (const setting of effects.settings) setting.enabled = false
    const speed = effects.settings.find((setting) => setting.id === 'speed')
    assert.ok(speed)
    speed.enabled = true
    speed.min = 1.1
    speed.max = 1.1
  })
  const args = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  assert.ok(!args.includes('copy'))
  const codecIndex = args.indexOf('-c:a')
  assert.equal(args[codecIndex + 1], 'aac')
})

test('a silent source gets -an and no audio chain', () => {
  const manifest = manifestFor(() => {})
  const silent = { ...probe, hasAudio: false, audioCodec: null }
  const args = buildFfmpegArgs(manifest, silent, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  assert.ok(args.includes('-an'))
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.ok(!graph.includes('[aout]'))
})

test('provenance tag and GPS strip are written as metadata args', () => {
  const manifest = neutral()
  const args = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  assert.ok(args.some((value) => value.startsWith('description=Video Batcher variation=')))
  assert.ok(args.includes('location='))
})

test('threads are only passed to the multithreaded core', () => {
  const manifest = manifestFor(() => {})
  const st = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 4, multithreaded: false })
  const mt = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 4, multithreaded: true })
  assert.ok(!st.includes('-threads'))
  assert.ok(mt.includes('-threads'))
  assert.ok(mt.includes('-filter_complex_threads'))
})

test('the trim is expressed with -ss before input and -t after', () => {
  const manifest = manifestFor((effects) => {
    for (const setting of effects.settings) setting.enabled = false
    const cut = effects.settings.find((setting) => setting.id === 'cutStart')
    assert.ok(cut)
    cut.enabled = true
    cut.min = 1.5
    cut.max = 1.5
  })
  const args = buildFfmpegArgs(manifest, probe, { inputPath: '/in/input.mp4', threads: 1, multithreaded: false })
  const ssIndex = args.indexOf('-ss')
  const inputIndex = args.indexOf('-i')
  assert.ok(ssIndex > -1 && ssIndex < inputIndex)
  assert.equal(args[ssIndex + 1], '1.500000')
  assert.ok(args.includes('-t'))
  assert.equal(args[args.indexOf('-t') + 1], '10.500000')
})
