/**
 * Fast MP4/MOV metadata probe.
 *
 * Reading duration/resolution/codecs by parsing the container itself takes
 * single-digit milliseconds on any size file, where booting ffprobe costs
 * seconds of WASM startup. For reel-length MP4s this is the difference
 * between "metadata appears instantly" and "wait for the engine" (§5).
 *
 * Only what the planner needs is parsed: mvhd (duration), tkhd (dimensions,
 * rotation), mdhd + stsz (fps), stsd (codecs, channels, sample rate). Anything
 * unusual — fragmented MP4 with a zero-duration header, unexpected layout —
 * returns null and the engine falls back to ffprobe in a worker.
 */

export type Mp4Probe = {
  durationSeconds: number | null
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  audioChannels: number | null
  sampleRate: number | null
  rotation: number
  hasVideo: boolean
  hasAudio: boolean
  bitrate: number | null
}

const VIDEO_CODECS: Record<string, string> = {
  avc1: 'h264',
  avc3: 'h264',
  hvc1: 'hevc',
  hev1: 'hevc',
  av01: 'av1',
  vp09: 'vp9',
  mp4v: 'mpeg4',
}

const AUDIO_CODECS: Record<string, string> = {
  mp4a: 'aac',
  'ac-3': 'ac3',
  'ec-3': 'eac3',
  alac: 'alac',
  Opus: 'opus',
  fLaC: 'flac',
  '.mp3': 'mp3',
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf'])

type Reader = {
  u8(offset: number): Promise<number>
  u16(offset: number): Promise<number>
  u32(offset: number): Promise<number>
  u64(offset: number): Promise<bigint>
  i32(offset: number): Promise<number>
}

function makeReader(file: Blob): Reader {
  const cache = new Map<number, Uint8Array>()
  const PAGE = 64 * 1024

  async function page(offset: number): Promise<{ bytes: Uint8Array; base: number }> {
    const base = Math.max(0, Math.floor(offset / PAGE) * PAGE)
    let bytes = cache.get(base)
    if (!bytes) {
      if (cache.size > 24) cache.clear()
      const end = Math.min(file.size, base + PAGE + 8)
      bytes = new Uint8Array(await file.slice(base, end).arrayBuffer())
      cache.set(base, bytes)
    }
    return { bytes, base }
  }

  async function view(offset: number, length: number): Promise<DataView> {
    const { bytes, base } = await page(offset)
    const start = offset - base
    if (start + length <= bytes.byteLength) {
      return new DataView(bytes.buffer, bytes.byteOffset + start, length)
    }
    // Straddles a page: read directly.
    const exact = await file.slice(offset, offset + length).arrayBuffer()
    return new DataView(exact)
  }

  return {
    u8: async (o) => (await view(o, 1)).getUint8(0),
    u16: async (o) => (await view(o, 2)).getUint16(0),
    u32: async (o) => (await view(o, 4)).getUint32(0),
    u64: async (o) => (await view(o, 8)).getBigUint64(0),
    i32: async (o) => (await view(o, 4)).getInt32(0),
  }
}

type Box = { type: string; start: number; headerSize: number; size: number }

/** Iterate the boxes directly inside [start, end). */
async function* boxes(reader: Reader, start: number, end: number): AsyncGenerator<Box> {
  let offset = start
  while (offset + 8 <= end) {
    const size32 = await reader.u32(offset)
    const type = String.fromCharCode(
      await reader.u8(offset + 4),
      await reader.u8(offset + 5),
      await reader.u8(offset + 6),
      await reader.u8(offset + 7),
    )
    let size = size32
    let headerSize = 8
    if (size32 === 1) {
      const large = await reader.u64(offset + 8)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return
      size = Number(large)
      headerSize = 16
    } else if (size32 === 0) {
      size = end - offset
    }
    if (size < headerSize) return
    yield { type, start: offset, headerSize, size }
    offset += size
  }
}

async function readFourCC(reader: Reader, offset: number): Promise<string> {
  return String.fromCharCode(
    await reader.u8(offset),
    await reader.u8(offset + 1),
    await reader.u8(offset + 2),
    await reader.u8(offset + 3),
  )
}

type TrackInfo = {
  handler: string | null
  timescale: number
  duration: number
  sampleCount: number
  width: number
  height: number
  rotation: number
  codec: string | null
  channels: number | null
  sampleRate: number | null
}

function rotationFromMatrix(a: number, b: number, c: number, d: number): number {
  // tkhd matrix stored as 16.16 fixed point (top-left 2x2).
  const A = a / 65536
  const B = b / 65536
  const C = c / 65536
  const D = d / 65536
  if (Math.abs(A - 1) < 0.01 && Math.abs(D - 1) < 0.01) return 0
  if (Math.abs(A + 1) < 0.01 && Math.abs(D + 1) < 0.01) return 180
  if (Math.abs(B - 1) < 0.01 && Math.abs(C + 1) < 0.01) return 90
  if (Math.abs(B + 1) < 0.01 && Math.abs(C - 1) < 0.01) return 270
  return 0
}

async function parseStsd(reader: Reader, box: Box): Promise<Partial<TrackInfo>> {
  const base = box.start + box.headerSize
  const entryCount = await reader.u32(base + 4)
  if (entryCount < 1) return {}
  const entryStart = base + 8
  const codec = await readFourCC(reader, entryStart + 4)
  const result: Partial<TrackInfo> = { codec }

  if (AUDIO_CODECS[codec]) {
    // SampleEntry: size(4) type(4) reserved(6) data_ref(2) = 16.
    // AudioSampleEntry then: version(2) revision(2) vendor(4) → the ISO
    // "reserved[2]" 8 bytes — then channelcount(2) @24, samplesize(2),
    // pre_defined(2), reserved(2), samplerate(4, 16.16 fixed) @32.
    const channels = await reader.u16(entryStart + 24)
    const rate = await reader.u32(entryStart + 32)
    result.channels = channels
    result.sampleRate = Math.round(rate / 65536)
  }
  return result
}

async function parseTrak(reader: Reader, trak: Box): Promise<TrackInfo | null> {
  const info: TrackInfo = {
    handler: null,
    timescale: 0,
    duration: 0,
    sampleCount: 0,
    width: 0,
    height: 0,
    rotation: 0,
    codec: null,
    channels: null,
    sampleRate: null,
  }
  let found = false
  const end = trak.start + trak.size

  for await (const box of boxes(reader, trak.start + trak.headerSize, end)) {
    const base = box.start + box.headerSize
    if (box.type === 'tkhd') {
      const version = await reader.u8(base)
      const widthOffset = version === 1 ? 88 : 76
      info.width = (await reader.u32(box.start + box.headerSize + widthOffset)) / 65536
      info.height = (await reader.u32(box.start + box.headerSize + widthOffset + 4)) / 65536
      const matrixOffset = version === 1 ? 52 : 40
      const a = await reader.i32(box.start + box.headerSize + matrixOffset)
      const b = await reader.i32(box.start + box.headerSize + matrixOffset + 4)
      const c = await reader.i32(box.start + box.headerSize + matrixOffset + 12)
      const d = await reader.i32(box.start + box.headerSize + matrixOffset + 16)
      info.rotation = rotationFromMatrix(a, b, c, d)
      found = true
    } else if (box.type === 'mdia') {
      const mdiaEnd = box.start + box.size
      for await (const mdiaBox of boxes(reader, box.start + box.headerSize, mdiaEnd)) {
        const mdiaBase = mdiaBox.start + mdiaBox.headerSize
        if (mdiaBox.type === 'mdhd') {
          const version = await reader.u8(mdiaBase)
          if (version === 1) {
            info.timescale = await reader.u32(mdiaBase + 20)
            info.duration = Number(await reader.u64(mdiaBase + 24))
          } else {
            info.timescale = await reader.u32(mdiaBase + 12)
            info.duration = await reader.u32(mdiaBase + 16)
          }
          found = true
        } else if (mdiaBox.type === 'hdlr') {
          info.handler = await readFourCC(reader, mdiaBase + 8)
          found = true
        } else if (mdiaBox.type === 'minf') {
          const minfEnd = mdiaBox.start + mdiaBox.size
          for await (const minfBox of boxes(reader, mdiaBox.start + mdiaBox.headerSize, minfEnd)) {
            if (minfBox.type !== 'stbl') continue
            const stblEnd = minfBox.start + minfBox.size
            for await (const stblBox of boxes(reader, minfBox.start + minfBox.headerSize, stblEnd)) {
              if (stblBox.type === 'stsd') {
                Object.assign(info, await parseStsd(reader, stblBox))
              } else if (stblBox.type === 'stsz') {
                info.sampleCount = await reader.u32(stblBox.start + stblBox.headerSize + 8)
              }
            }
          }
        }
      }
    }
  }
  return found ? info : null
}

export async function probeMp4(file: Blob): Promise<Mp4Probe | null> {
  try {
    const reader = makeReader(file)
    let moov: Box | null = null
    let mvhdDuration = 0
    let mvhdTimescale = 0

    for await (const box of boxes(reader, 0, file.size)) {
      // Box walk reads headers only — mdat contents are never touched, so a
      // moov at the end of the file costs the same few reads as one at the top.
      if (box.type === 'moov') {
        moov = box
        break
      }
    }
    if (!moov) return null

    const tracks: TrackInfo[] = []
    for await (const box of boxes(reader, moov.start + moov.headerSize, moov.start + moov.size)) {
      if (box.type === 'mvhd') {
        const version = await reader.u8(box.start + box.headerSize)
        if (version === 1) {
          mvhdTimescale = await reader.u32(box.start + box.headerSize + 20)
          mvhdDuration = Number(await reader.u64(box.start + box.headerSize + 24))
        } else {
          mvhdTimescale = await reader.u32(box.start + box.headerSize + 12)
          mvhdDuration = await reader.u32(box.start + box.headerSize + 16)
        }
      } else if (box.type === 'trak') {
        const track = await parseTrak(reader, box)
        if (track) tracks.push(track)
      }
    }

    const video = tracks.find((track) => track.handler === 'vide')
    const audio = tracks.find((track) => track.handler === 'soun')
    if (!video && !audio) return null

    let duration: number | null = null
    if (mvhdTimescale > 0 && mvhdDuration > 0) {
      duration = mvhdDuration / mvhdTimescale
    } else if (video && video.timescale > 0 && video.duration > 0) {
      duration = video.duration / video.timescale
    }

    let fps: number | null = null
    if (video && video.timescale > 0 && video.duration > 0 && video.sampleCount > 0) {
      const computed = (video.sampleCount * video.timescale) / video.duration
      if (computed > 1 && computed < 480) fps = Math.round(computed * 100) / 100
    }

    const rotation = video?.rotation ?? 0
    let width = video ? Math.round(video.width) : null
    let height = video ? Math.round(video.height) : null
    if (rotation === 90 || rotation === 270) {
      const swap = width
      width = height
      height = swap
    }

    return {
      durationSeconds: duration,
      width: width && width > 0 ? width : null,
      height: height && height > 0 ? height : null,
      fps,
      videoCodec: video ? VIDEO_CODECS[video.codec ?? ''] ?? video.codec : null,
      audioCodec: audio ? AUDIO_CODECS[audio.codec ?? ''] ?? audio.codec : null,
      audioChannels: audio?.channels ?? null,
      sampleRate: audio?.sampleRate ?? null,
      rotation: rotation === 90 || rotation === 270 || rotation === 180 ? rotation : 0,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
      bitrate: duration && duration > 0 ? Math.round((file.size * 8) / duration) : null,
    }
  } catch {
    return null
  }
}
