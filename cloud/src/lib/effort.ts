/**
 * How much work a card is, read off the video itself.
 *
 * Geno, 2026-10-06: every video should say how hard it is, and the week
 * should batch look-alike setups together — all the talking heads in one
 * sitting, all the propped-phone visuals in another — so the quick ones get
 * knocked out first. This was spec item F ("effort badge + easiest-first
 * sort") from 2026-09-27, now with his setup sections on top.
 *
 * The score comes from what the Mac measured (`src/shots.py` → `t.shots`),
 * never from the format tag alone: cuts to film, whether the phone moves or
 * someone else holds it, people needed, lines to deliver, text to put on
 * screen, and length. A card the look pass has not reached falls back to its
 * format tags. Pure and import-light, like `shotlist.ts`: her page computes
 * it in the browser and the tests run it without a database.
 */

import { settled, type Measured } from './shotlist'

export type EffortTier = 'quick' | 'medium' | 'big'

export type Effort = {
  tier: EffortTier
  /** The chip on the card, in her words. */
  label: string
  /** Why, in one short line — "1 shot · prop the phone · no lines". */
  why: string
  /** Higher = more work. Kept so a section can sort easiest first. */
  score: number
}

/** The slice of a card the score reads. Matches PlanItem's fields. */
export type EffortInput = {
  shots: Measured | null
  blocks: { start: number; text: string }[]
  on_screen_captions: { t?: number | null; text?: string | null }[] | null
  duration_sec: number | null
  formats: string[]
  original_audio: boolean | null
}

const LABELS: Record<EffortTier, string> = {
  quick: 'Quick one',
  medium: 'Medium',
  big: 'Bigger shoot',
}

/** Formats that are usually one propped shot with no lines. The fallback for
 *  unmeasured cards only — a measured skit that is actually one selfie take
 *  scores from the measurement, not the tag. */
const QUICK_FORMATS = new Set(['text-overlay', 'thirst-trap', 'fit-check', 'try-on', 'dance', 'teaser'])
const BIG_FORMATS = new Set(['skit', 'pov-skit', 'street-interview', 'comedy', 'reaction'])

const wordsOf = (blocks: EffortInput['blocks']): number =>
  blocks.reduce((count, block) => count + block.text.split(/\s+/).filter(Boolean).length, 0)

/** Distinct camera setups: consecutive shots that keep the same hold (selfie /
 *  propped / held) and scene read as one setup — a cut back to the same
 *  propped phone is not a new tripod. */
function setupsOf(measured: Measured): number {
  let setups = 0
  let last = ''
  for (const raw of measured.shots) {
    const shot = settled(raw)
    const hold = shot.people === 0 ? 'broll' : shot.selfie ? 'selfie' : shot.camera
    const scene = shot.labels[0] ?? ''
    const key = `${hold}|${scene}`
    if (key !== last) setups += 1
    last = key
  }
  return Math.max(setups, 1)
}

export function effortFor(item: EffortInput): Effort {
  const screenLines = (item.on_screen_captions ?? []).filter((caption) => caption.text?.trim()).length
  // Words on a borrowed sound are the audio's, not lines she has to deliver.
  const ownWords = item.original_audio === false ? 0 : wordsOf(item.blocks)
  const minutes = item.duration_sec ?? 0

  if (item.shots && item.shots.shots.length > 0) {
    const shots = item.shots.shots.map(settled)
    const cuts = shots.length
    const setups = setupsOf(item.shots)
    const people = Math.max(...shots.map((shot) => shot.people), 0)
    const held = shots.some((shot) => shot.people > 0 && !shot.selfie && shot.camera !== 'still')

    let score = 0
    score += (cuts - 1) * 1.5 // every extra cut is another take
    score += (setups - 1) * 3 // moving the phone costs more than cutting
    score += ownWords > 40 ? 3 : ownWords > 0 ? 1.5 : 0
    score += screenLines > 4 ? 2 : screenLines > 0 ? 1 : 0
    score += held ? 2 : 0 // someone (or she) carries the phone through it
    score += people > 1 ? 6 : 0 // needs another person: never a quick one
    score += minutes > 45 ? 2 : 0

    const tier: EffortTier = people > 1 || score >= 9 ? 'big' : score >= 4 ? 'medium' : 'quick'

    const why: string[] = [`${cuts} shot${cuts === 1 ? '' : 's'}`]
    if (people > 1) why.push('needs another person')
    else if (held) why.push('phone in hand')
    else why.push('prop the phone')
    why.push(ownWords > 0 ? (ownWords > 40 ? 'lines to say' : 'a line or two') : 'no lines')
    if (screenLines > 0) why.push('text to add')
    return { tier, label: LABELS[tier], why: why.join(' · '), score }
  }

  // Unmeasured: the tag is all there is.
  const big = item.formats.some((format) => BIG_FORMATS.has(format))
  const quick = !big
    && item.formats.some((format) => QUICK_FORMATS.has(format))
    && ownWords === 0
  const tier: EffortTier = big ? 'big' : quick ? 'quick' : 'medium'
  const score = big ? 10 : quick ? 2 : 5
  return { tier, label: LABELS[tier], why: '', score }
}

/* ============================================================
   Setup sections — the week batched by how it gets filmed.
   ============================================================ */

export type SetupKey = 'text' | 'talk' | 'big'

export type SetupSection<T> = {
  key: SetupKey
  /** The bar above the section. */
  label: string
  /** One line under the bar; only the easiest section carries the nudge. */
  note: string | null
  items: T[]
}

const SETUP_LABELS: Record<SetupKey, string> = {
  text: 'No talking — text goes on top',
  talk: 'Talking to the camera',
  big: 'Skits & bigger shoots',
}

const START_NOTE = 'Start here — quickest to film. Prop the phone and knock these out first.'

/** Which sitting a card belongs to. Measured speech beats the tag: a
 *  "talking-head" that is actually silent films like a visual. */
export function setupFor(item: EffortInput): SetupKey {
  const effort = effortFor(item)
  if (effort.tier === 'big') return 'big'
  const ownWords = item.original_audio === false ? 0 : wordsOf(item.blocks)
  return ownWords > 0 ? 'talk' : 'text'
}

/**
 * The week in filming sittings, easiest sitting first, easiest card first
 * inside each. Returns null when everything lands in one sitting — the page
 * then falls back to the location grouping it always had, so an old week
 * (or a one-note week) looks exactly as before.
 */
export function groupBySetup<T extends EffortInput>(items: T[]): SetupSection<T>[] | null {
  const buckets = new Map<SetupKey, T[]>()
  for (const item of items) {
    const key = setupFor(item)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  if (buckets.size < 2) return null
  const sections = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: SETUP_LABELS[key],
    note: null as string | null,
    items: [...bucket].sort((a, b) => effortFor(a).score - effortFor(b).score),
    mean: bucket.reduce((sum, item) => sum + effortFor(item).score, 0) / bucket.length,
  }))
  sections.sort((a, b) => a.mean - b.mean)
  return sections.map(({ mean: _mean, ...section }, index) => ({
    ...section,
    note: index === 0 ? START_NOTE : null,
  }))
}
