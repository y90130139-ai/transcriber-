/**
 * The shot scaffold: what a winning reel *did*, beat by beat, so it can be
 * rebuilt rather than admired.
 *
 * This is deliberately **not** a script writer. It invents no lines. It reads
 * the structure the reference actually used — how many beats, at what second,
 * which one carried the turn — and hands that skeleton over with the
 * reference's own words shown as reference, never as her copy.
 *
 * That distinction is the whole design. Constitution rule 3 says anything the
 * user reads as a judgement stays deterministic, and rule 4 says say less
 * rather than invent. A structural extraction obeys both: every claim here is
 * measured off the source. Generating her actual lines is a different feature
 * with a different risk profile and it is not this one.
 *
 * **Nothing is written into the brief.** The scaffold is computed on read and
 * rendered separately, so it never becomes a new form of drafted text — which
 * would strand every card written before it under `isUntouchedDraft`. That trap
 * cost 67 references once already; it is not worth re-opening for a read-only
 * view.
 */
import type { OnScreenCaption } from './autotag'

/** Below this a "beat" is OCR noise or a watermark, not a story turn. */
const MIN_BEAT_CHARS = 3

/** More than this and we are reading a subtitle track, not a set of cards. */
const MAX_BEATS = 6

/** A closing beat at or under this many words is a punchline, not a sentence.
 *  Same threshold the comparison-shape hook rule uses, deliberately. */
const PUNCHLINE_WORDS = 6

export type ScaffoldBeat = {
  /** Seconds into the reference, when known. */
  at: number | null
  /** What the reference put here. Shown as reference, never as her line. */
  reference: string
  /** What this beat is doing structurally. */
  role: 'open' | 'turn' | 'hold' | 'close'
  /** What she has to reproduce, in terms of function rather than words. */
  instruction: string
}

export type Scaffold = {
  beats: ScaffoldBeat[]
  /** Total run time of the reference, when known. */
  durationSec: number | null
  /** The one-line summary of the mechanism being copied. */
  mechanism: string
  /** Why this reference is worth rebuilding at all. */
  evidence: string | null
}

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Roles for a run of beats. The turn is the last one when it is short enough
 *  to be a punchline — the shape phase 7 measured as the commonest here. */
function roleFor(index: number, total: number, text: string): ScaffoldBeat['role'] {
  if (index === 0) return 'open'
  if (index === total - 1) return words(text) <= PUNCHLINE_WORDS ? 'turn' : 'close'
  return 'hold'
}

const INSTRUCTION: Record<ScaffoldBeat['role'], string> = {
  open: 'Open here. Same job as the reference — set the situation in one card, before anything moves.',
  hold: 'Hold the frame. This beat exists to let the setup land; do not rush it.',
  turn: 'This is the turn, and it is why the reel worked. Keep it short and keep it last.',
  close: 'Close it out. Land the thought rather than adding a new one.',
}

const MECHANISM: Record<string, string> = {
  contrast: 'Two beats that disagree. The second one contradicts the first — that gap is the joke.',
  'pov-relatable': 'A scenario the viewer recognises as themselves. Name the situation, then just be in it.',
  question: 'Opens on a question the viewer wants answered, and makes them stay for the answer.',
  'direct-address': 'Talks straight down the lens from the first frame. No wind-up.',
  'text-claim': 'A claim stamped on the frame carries the hook; the footage underneath is secondary.',
  'in-media-res': 'Starts mid-action, as though the viewer walked in late.',
  transition: 'A reveal. Everything before the cut exists to make the cut land.',
  'trending-audio': 'Rides a sound the viewer already knows. The audio is the hook, not the visual.',
}

export type ScaffoldInput = {
  hooks: string[]
  formats: string[]
  firstLine: string | null
  onScreenCaptions?: OnScreenCaption[] | null
  durationSec: number | null
  /** Outperformance against the creator's own median, when known. */
  outperformance?: number | null
}

/**
 * Build the scaffold, or return null when there is nothing honest to say.
 *
 * Null is the common case for a talking-head reel with no on-screen cards and
 * one long spoken take: there are no beats to extract, and inventing some would
 * be exactly the confidently-wrong draft the constitution forbids.
 */
export function buildScaffold(input: ScaffoldInput): Scaffold | null {
  const readings = (input.onScreenCaptions ?? [])
    .map((beat) => ({ at: beat.t ?? null, text: clean(beat.text ?? '') }))
    .filter((beat) => beat.text.length >= MIN_BEAT_CHARS)
    .slice(0, MAX_BEATS)

  // A spoken reel with no cards still has one beat worth naming: its opening
  // line is its hook. One beat is a thin scaffold but an honest one.
  const source =
    readings.length > 0
      ? readings
      : input.firstLine && clean(input.firstLine).length >= MIN_BEAT_CHARS
        ? [{ at: 0, text: clean(input.firstLine) }]
        : []

  if (source.length === 0) return null

  const beats: ScaffoldBeat[] = source.map((beat, index) => {
    const role = roleFor(index, source.length, beat.text)
    return { at: beat.at, reference: beat.text, role, instruction: INSTRUCTION[role] }
  })

  const hook = input.hooks.find((tag) => tag in MECHANISM) ?? null
  const mechanism = hook
    ? MECHANISM[hook]
    : `${beats.length} beat${beats.length === 1 ? '' : 's'}, in this order.`

  const multiple = input.outperformance
  const evidence =
    multiple && multiple >= 1.2
      ? `Did ${multiple}× this creator's own median — ${Math.round((multiple - 1) * 100)}% above their normal.`
      : null

  return { beats, durationSec: input.durationSec, mechanism, evidence }
}
