/**
 * The creator questionnaire's rules: what counts as a valid answer, the
 * priority her volume earns, and how her answers land on her profile.
 *
 * Geno, 2026-10-02: input is output. The more she can make, the more often,
 * the higher she sits in priority (S/A/B/C, which decides who gets first pick
 * of reels — lib/batch.ts, lib/draft.ts). Her answers apply on submit with no
 * approval step, and they win: numbers are replaced, tags are added to what
 * Geno already set, and a format she says she won't do comes off her formats.
 * Every change is returned so it can be logged and shown.
 */
import { isValidTag } from '../taxonomy'

export type Lang = 'en' | 'es'
export type Priority = 'S' | 'A' | 'B' | 'C'
export const TIMES = ['morning', 'midday', 'afternoon', 'evening', 'late'] as const
export type TimeSlot = (typeof TIMES)[number]
export const BUSY = ['ahead', 'catchup', 'skip'] as const
export type Busy = (typeof BUSY)[number]

/** Formats that show who she is — Geno: these convert better than text
 *  overlays, because personality is what a viewer follows. */
export const ON_CAMERA = [
  'talking-head', 'storytime', 'skit', 'pov-skit', 'comedy', 'q-and-a', 'confession',
  'car-confession', 'grwm', 'rant', 'advice', 'day-in-life', 'reaction', 'street-interview',
]
/** Fast to make in bulk, weaker at turning a viewer into a fan. */
export const BATCH = [
  'text-overlay', 'thirst-trap', 'lip-sync', 'mirror', 'dance', 'fit-check', 'try-on',
  'reveal', 'teaser', 'snap-banner',
]

export const MAX_PERSONAS = 3
const MAX_PER_DAY = 10
const MAX_WEEKLY = 100

/** Reels a week each priority starts at. */
export const PRIORITY_FLOOR: { priority: Priority; weekly: number }[] = [
  { priority: 'S', weekly: 21 },
  { priority: 'A', weekly: 14 },
  { priority: 'B', weekly: 7 },
  { priority: 'C', weekly: 0 },
]
const ORDER: Priority[] = ['S', 'A', 'B', 'C']

export type Answers = {
  lang: Lang
  per_day: number
  days: number[]
  times: TimeSlot[]
  weekly: number
  formats: string[]
  wont: string[]
  personas: string[]
  busy: Busy
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])] : null

export function readSurvey(body: unknown): { answers: Answers } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'No answers were sent.' }
  const b = body as Record<string, unknown>
  const lang: Lang = b.lang === 'es' ? 'es' : 'en'
  if (!isInt(b.per_day, 1, MAX_PER_DAY)) return { error: 'How many reels a day is missing.' }
  if (!isInt(b.weekly, 1, MAX_WEEKLY)) return { error: 'How many reels a week is missing.' }

  const days = Array.isArray(b.days) ? [...new Set(b.days)] : null
  if (!days || days.length === 0 || !days.every((d) => isInt(d, 0, 6))) return { error: 'Pick at least one day.' }

  const times = strings(b.times)
  if (!times || times.length === 0 || !times.every((t) => (TIMES as readonly string[]).includes(t))) {
    return { error: 'Pick at least one time of day.' }
  }
  const formats = strings(b.formats)
  if (!formats || formats.length === 0 || !formats.every((f) => isValidTag('format', f))) {
    return { error: 'Pick at least one kind of video.' }
  }
  const wont = strings(b.wont ?? [])
  if (!wont || !wont.every((f) => isValidTag('format', f))) return { error: 'One of the "won’t do" choices is not recognised.' }
  const personas = strings(b.personas ?? [])
  if (!personas || personas.length > MAX_PERSONAS || !personas.every((p) => isValidTag('persona', p))) {
    return { error: `Pick up to ${MAX_PERSONAS} that sound like you.` }
  }
  if (typeof b.busy !== 'string' || !(BUSY as readonly string[]).includes(b.busy)) return { error: 'The busy-week question is missing.' }

  return {
    answers: {
      lang,
      per_day: b.per_day,
      days: (days as number[]).sort((x, y) => x - y),
      times: times as TimeSlot[],
      weekly: b.weekly,
      formats,
      // What she picked to make wins over what she picked to avoid.
      wont: wont.filter((f) => !formats.includes(f)),
      personas,
      busy: b.busy as Busy,
    },
  }
}

const hasOnCamera = (formats: string[]) => formats.some((f) => ON_CAMERA.includes(f))
const baseFor = (weekly: number): Priority => PRIORITY_FLOOR.find((f) => weekly >= f.weekly)!.priority

export function priorityFor(weekly: number, formats: string[]) {
  const base = baseFor(weekly)
  if (hasOnCamera(formats) || base === 'C') return { priority: base, base, steppedDown: false }
  return { priority: ORDER[ORDER.indexOf(base) + 1], base, steppedDown: true }
}

export type NextStep = { kind: 'volume'; more: number; to: Priority } | { kind: 'on-camera'; to: Priority } | { kind: 'top' }

/** The one thing that would move her up — volume first, it is the lever. */
export function nextStep(weekly: number, formats: string[]): NextStep {
  const { priority, base, steppedDown } = priorityFor(weekly, formats)
  if (steppedDown) return { kind: 'on-camera', to: base }
  if (priority === 'S') return { kind: 'top' }
  const up = PRIORITY_FLOOR[ORDER.indexOf(priority) - 1]
  return { kind: 'volume', more: up.weekly - weekly, to: up.priority }
}

export type CurrentProfile = {
  weekly_target: number
  filming_days: number[]
  formats: string[]
  wont_do: string[]
  persona: string[]
  priority: Priority | null
}
export type Change = { field: string; from: unknown; to: unknown }

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function mergeProfile(current: CurrentProfile, a: Answers) {
  const wont_do = sorted([...current.wont_do, ...a.wont].filter((f) => !a.formats.includes(f)))
  const profile = {
    weekly_target: a.weekly,
    daily_capacity: a.per_day,
    filming_days: a.days,
    best_times: a.times,
    formats: sorted([...current.formats, ...a.formats].filter((f) => !wont_do.includes(f))),
    wont_do,
    persona: sorted([...current.persona, ...a.personas]),
    priority: priorityFor(a.weekly, a.formats).priority,
  }
  const before: Record<string, unknown> = { ...current }
  const changes: Change[] = Object.entries(profile)
    .filter(([field, to]) => field in before && !same(before[field], to))
    .map(([field, to]) => ({ field, from: before[field], to }))
  return { profile, changes }
}
