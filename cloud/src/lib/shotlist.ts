/**
 * "Film it" as a shot list, written from what the reference actually shows.
 *
 * Geno, 2026-09-27: the old directions came from a table keyed on the reel's
 * format tag, so a selfie text reel said "back camera", every thirst trap said
 * "propped low", and a reel that cut from her reaction to a clip of a horse
 * running off was briefed as one shot. Too many words, and often not the video.
 *
 * The Mac now measures the picture (`src/shots.py`): where the cuts are, who is
 * in each shot and how close, whether the phone moves, what is in a shot nobody
 * is in, and — when the vision pass has run — a one-line description. This
 * turns that into a few short lines per shot: what the camera does, what to
 * show, what to say. Pure and import-free: her page builds it in the browser
 * and the tests build it without a database.
 */

export type MeasuredShot = {
  start: number
  end: number
  people: number
  framing: 'close' | 'mid' | 'full' | 'none' | 'unknown'
  camera: 'still' | 'handheld' | 'moving' | 'unknown'
  selfie?: boolean
  labels: string[]
  /** One line from the vision pass, when it has run. */
  describe?: string | null
  /** How the vision pass thinks the phone was held. It sees an arm holding
   *  the phone, which movement alone cannot; movement sees a propped phone,
   *  which one frame cannot. Each overrides the other only where it is sure. */
  camera_seen?: 'selfie' | 'someone' | 'propped' | 'none' | null
}

export type Measured = { version: number; duration: number; shots: MeasuredShot[]; described?: boolean }

/** The measurement, corrected by what the vision pass saw where it is sure. */
export function settled(shot: MeasuredShot): MeasuredShot {
  if (!shot.camera_seen || shot.people === 0) return shot
  if (shot.camera_seen === 'selfie') return { ...shot, selfie: true }
  if (shot.camera_seen === 'propped' && shot.camera !== 'moving') return { ...shot, selfie: false, camera: 'still' }
  if (shot.camera_seen === 'someone') return { ...shot, selfie: false, camera: shot.camera === 'still' ? 'handheld' : shot.camera }
  return shot
}

export type ShotStep = {
  /** 1-based. */
  no: number
  from: number
  to: number
  /** She is in it; false for a clip of something else. */
  you: boolean
  /** What the phone does, in a few words. */
  camera: string
  /** What happens, when the vision pass has said. */
  what: string | null
  /** Text on screen during this shot. */
  show: string | null
  /** Words spoken during this shot. */
  say: string | null
}

export type ShotList = {
  /** The whole setup in a line of chips: "📱 Selfie · in your hand", "2 shots", "8 sec". */
  chips: string[]
  steps: ShotStep[]
  sound: string
}

type Timed = { t?: number | null; start?: number; text?: string | null }

const MAX_LINE = 90

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_LINE) return clean
  const cut = clean.slice(0, MAX_LINE)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : MAX_LINE)}…`
}

/** How the phone was held, in her words. */
export function cameraLine(shot: Pick<MeasuredShot, 'people' | 'framing' | 'camera' | 'selfie'>): string {
  if (shot.people === 0) {
    if (shot.camera === 'still') return 'Phone still, pointed at it'
    return 'Phone in your hand, filming it'
  }
  if (shot.selfie) return 'Selfie — front camera, phone in your hand'
  const size = shot.framing === 'close' ? 'close up' : shot.framing === 'full' ? 'full length' : 'waist up'
  if (shot.camera === 'still') return `Phone propped up, ${size}`
  if (shot.camera === 'unknown') return size.charAt(0).toUpperCase() + size.slice(1)
  return `Someone holds the phone, ${size}`
}

/** The setup chip: the first shot she is in decides it. */
function setupChip(shots: MeasuredShot[]): string | null {
  const first = shots.find((shot) => shot.people > 0)
  if (!first) return '🎥 No one on camera'
  if (first.selfie) return '📱 Selfie · in your hand'
  if (first.camera === 'still') return '📱 Phone propped up'
  if (first.camera === 'unknown') return null
  return '🤳 Someone films you'
}

/** A clip nobody is in, named by what Vision saw in it. */
function clipLine(shot: MeasuredShot): string {
  const thing = shot.labels.find(Boolean)?.replace(/_/g, ' ')
  return thing ? `A clip of: ${thing} — film your own or use a similar clip` : 'A clip, not you — film your own or use a similar clip'
}

function within(lines: Timed[], from: number, to: number, last: boolean): string | null {
  const hit = lines.find((line) => {
    const at = line.t ?? line.start
    return typeof at === 'number' && at >= from - 0.3 && (at < to || (last && at <= to + 0.5)) && line.text?.trim()
  })
  return hit?.text ? clip(hit.text) : null
}

export function buildShotList(input: {
  measured: Measured | null
  /** Readable on-screen lines only — junk is filtered before this. */
  screen: { t?: number | null; text?: string | null }[] | null
  speech: { start: number; text: string }[]
  sound: { title: string | null; original: boolean | null }
}): ShotList | null {
  const shots = (input.measured?.shots ?? []).map(settled)
  if (!shots.length) return null
  const screen = input.screen ?? []
  const steps: ShotStep[] = shots.map((shot, index) => {
    const last = index === shots.length - 1
    const you = shot.people > 0
    return {
      no: index + 1,
      from: Math.round(shot.start),
      to: Math.max(Math.round(shot.end), Math.round(shot.start) + 1),
      you,
      camera: you ? cameraLine(shot) : clipLine(shot),
      what: shot.describe ? clip(shot.describe) : null,
      show: within(screen, shot.start, shot.end, last),
      say: within(input.speech, shot.start, shot.end, last),
    }
  })
  const duration = Math.round(input.measured?.duration ?? shots[shots.length - 1].end)
  const chips = [
    setupChip(shots),
    shots.length === 1 ? 'One shot' : `${shots.length} shots`,
    `${duration} sec`,
  ].filter((chip): chip is string => Boolean(chip))

  const spoken = input.speech.some((line) => line.text.trim())
  const sound = input.sound.title && input.sound.original === false
    ? `Use the sound “${clip(input.sound.title)}” — tap it on the original in Instagram`
    : spoken
      ? 'Your own voice — say it your way'
      : 'Take the audio from the original in Instagram'
  return { chips, steps, sound }
}

const MAX_DESCRIBE = 110
const CAMERAS = new Set(['selfie', 'someone', 'propped', 'none'])

/** Clean what the model said onto the measured shots. Anything malformed is
 *  dropped; a shot the model skipped keeps its measurement only. */
export function mergeDescriptions(
  measured: Measured,
  said: { shots?: { no?: unknown; what?: unknown; camera?: unknown }[] } | null,
): Measured {
  const byNo = new Map<number, { what: string | null; camera: string | null }>()
  for (const entry of said?.shots ?? []) {
    const no = Number(entry?.no)
    if (!Number.isInteger(no) || no < 1) continue
    const what = typeof entry.what === 'string' ? entry.what.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIBE) : ''
    const camera = typeof entry.camera === 'string' && CAMERAS.has(entry.camera) ? entry.camera : null
    byNo.set(no, { what: what || null, camera })
  }
  const shots: MeasuredShot[] = measured.shots.map((shot, index) => {
    const seen = byNo.get(index + 1)
    return seen ? { ...shot, describe: seen.what, camera_seen: seen.camera as MeasuredShot['camera_seen'] } : shot
  })
  return { ...measured, shots, described: true }
}

