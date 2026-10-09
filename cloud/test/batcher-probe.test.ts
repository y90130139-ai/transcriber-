// The fast MP4 prober — metadata in milliseconds, no engine startup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeMp4 } from '../src/lib/batcher/probe-mp4'

/* ------------------------------------------------------------ box builder */

function u32(bytes: number[] | Uint8Array): number[] {
  return [...bytes]
}

function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length
  return [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...type.split('').map((character) => character.charCodeAt(0)),
    ...payload,
  ]
}

function concat(parts: number[][]): number[] {
  return parts.flat()
}

/** version/flags (4 zero bytes) + body */
function full(body: number[]): number[] {
  return u32([0, 0, 0, 0]).concat(body)
}

function zeros(count: number): number[] {
  return new Array(count).fill(0)
}

function put32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function put16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function mvhd(timescale: number, duration: number): number[] {
  return box(
    'mvhd',
    full([
      ...put32(0), // creation
      ...put32(0), // modification
      ...put32(timescale),
      ...put32(duration),
      ...zeros(80),
    ]),
  )
}

function tkhd(width: number, height: number, rotate90: boolean): number[] {
  // matrix: identity, or 90° rotation (a=0 b=1 c=-1 d=0 in 16.16)
  const matrix = rotate90
    ? [
        ...put32(0), ...put32(65536), ...put32(0),
        ...put32(-65536), ...put32(0), ...put32(0),
        ...put32(0), ...put32(0), ...put32(1073741824),
      ]
    : [
        ...put32(65536), ...put32(0), ...put32(0),
        ...put32(0), ...put32(65536), ...put32(0),
        ...put32(0), ...put32(0), ...put32(1073741824),
      ]
  return box(
    'tkhd',
    full([
      ...put32(0), // creation
      ...put32(0), // modification
      ...put32(1), // track id
      ...put32(0), // reserved
      ...put32(0), // duration
      ...zeros(8), // reserved
      ...put16(0), // layer
      ...put16(0), // alternate group
      ...put16(0), // volume
      ...put16(0), // reserved
      ...matrix,
      ...put32(width * 65536),
      ...put32(height * 65536),
    ]),
  )
}

function mdia(handler: string, timescale: number, duration: number, sampleEntry: number[], sampleCount: number): number[] {
  return box('mdia', [
    ...box('mdhd', full([...put32(0), ...put32(0), ...put32(timescale), ...put32(duration), ...put16(0), ...put16(0)])),
    ...box('hdlr', full([...put32(0), ...handler.split('').map((c) => c.charCodeAt(0)), ...zeros(12)])),
    ...box('minf', [
      ...box('stbl', [
        ...box('stsd', full([...put32(1), ...sampleEntry])),
        ...box('stsz', full([...put32(0), ...put32(sampleCount)])),
      ]),
    ]),
  ])
}

function videoEntry(codec: string): number[] {
  // VisualSampleEntry: SampleEntry header + 8 reserved + 70 bytes of fixed
  // fields. The prober only reads the fourcc, so the rest is padding.
  return box(codec, [...zeros(6), ...put16(1), ...zeros(70)])
}

function audioEntry(codec: string, channels: number, rate: number): number[] {
  // SampleEntry header, then version/revision/vendor (the ISO reserved[2]),
  // then channelcount @16 of the payload and samplerate @24.
  return box(codec, [
    ...zeros(6),
    ...put16(1),
    ...put16(0),
    ...put16(0),
    ...put32(0),
    ...put16(channels),
    ...put16(16),
    ...put16(0),
    ...put16(0),
    ...put32(rate * 65536),
  ])
}

function buildMp4(options: { rotate?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const ftyp = box('ftyp', [
    ...'isom'.split('').map((c) => c.charCodeAt(0)),
    ...put32(0x200),
    ...'isomiso2avc1mp41'.split('').map((c) => c.charCodeAt(0)),
  ])

  const videoTrak = box('trak', [
    ...tkhd(1920, 1080, options.rotate === true),
    ...mdia('vide', 15360, 153600, videoEntry('avc1'), 300),
  ])
  const audioTrak = box('trak', [
    ...tkhd(0, 0, false),
    ...mdia('soun', 48000, 480000, audioEntry('mp4a', 2, 48000), 469),
  ])

  const moov = box('moov', [...mvhd(600, 6000), ...videoTrak, ...audioTrak])
  const mdat = box('mdat', zeros(64))
  return new Uint8Array(concat([ftyp, moov, mdat]))
}

/* ---------------------------------------------------------------- tests */

test('probe reads duration, dimensions, fps and codecs', async () => {
  const result = await probeMp4(new Blob([buildMp4()]))
  assert.ok(result)
  assert.equal(result.durationSeconds, 10)
  assert.equal(result.width, 1920)
  assert.equal(result.height, 1080)
  assert.equal(result.fps, 30)
  assert.equal(result.videoCodec, 'h264')
  assert.equal(result.audioCodec, 'aac')
  assert.equal(result.audioChannels, 2)
  assert.equal(result.sampleRate, 48000)
  assert.equal(result.hasVideo, true)
  assert.equal(result.hasAudio, true)
})

test('a 90° rotation swaps display dimensions', async () => {
  const result = await probeMp4(new Blob([buildMp4({ rotate: true })]))
  assert.ok(result)
  assert.equal(result.rotation, 90)
  assert.equal(result.width, 1080)
  assert.equal(result.height, 1920)
})

test('garbage returns null so the engine can fall back to ffprobe', async () => {
  assert.equal(await probeMp4(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])])), null)
})

test('an mdat without moov returns null instead of guessing', async () => {
  const mdat = box('mdat', zeros(32))
  assert.equal(await probeMp4(new Blob([new Uint8Array(concat([mdat]))])), null)
})
