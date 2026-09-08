/** Suggest persona, format and hook from what the video actually says.
 *
 * Hand-tagging hundreds of clips is how a library dies, so every finished job
 * arrives pre-tagged and the human's job shrinks to confirming or correcting.
 * Suggestions are marked `auto` in the database and are replaced wholesale on
 * a re-run; anything a human touched is marked `human` and is never overwritten.
 */
import { FORMAT_WORDS, HOOK_WORDS, PERSONA_WORDS } from './lexicon'
import type { Axis } from './taxonomy'

export type Suggestion = { axis: Axis; tag: string; score: number }

export type TagInput = {
  plain: string
  caption: string | null
  /** The opening line, which is the hook. */
  firstLine: string | null
  speakerCount: number | null
  wordCount: number | null
  durationSec: number | null
  /** Everything this creator has said across the library, for persona. */
  creatorText?: string
  /** A persona a human already stood behind for this creator wins outright. */
  creatorPersona?: string[]
}

const MAX_PER_AXIS = { persona: 2, format: 3, hook: 1 } as const

/** Persona is a claim about a person, so one stray word must not carry it —
 *  at 0.6 it takes two separate hits across everything they have said. A
 *  format or a hook can stand on a single unambiguous phrase. */
const KEEP_ABOVE: Record<Axis, number> = { persona: 0.6, format: 0.5, hook: 0.45 }
// A keyword is worth this much, and each extra one nudges it up without ever
// letting a single lexicon run away with the whole score.
const HIT_BASE = 0.55
const HIT_STEP = 0.08
const HIT_CEIL = 0.85
const SILENT_WORDS = 4
const SHORT_CLIP_SEC = 22

const lower = (value: string | null | undefined) => (value ?? '').toLowerCase()

/** Strip the transcript's own furniture: `[0:12] Speaker 2: ` before each turn.
 *  Left in, it makes every video open with a timestamp and every one of them
 *  read as having no hook. */
export function spokenWords(plain: string): string {
  return plain.replace(/\[\d+:\d{2}(?::\d{2})?\]\s*(Speaker\s*\d+\s*:\s*)?/g, '').trim()
}

const boundaries = new Map<string, RegExp>()

/** Whole-word matching. Without it `ink` fires on "thinking" and every talking
 *  video in the library gets tagged as a tattooed creator. */
function mentions(haystack: string, phrase: string): boolean {
  let pattern = boundaries.get(phrase)
  if (!pattern) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u')
    boundaries.set(phrase, pattern)
  }
  return pattern.test(haystack)
}

function hits(haystack: string, phrases: string[]): number {
  return phrases.reduce((count, phrase) => (mentions(haystack, phrase) ? count + 1 : count), 0)
}

function keywordScore(haystack: string, phrases: string[]): number {
  const found = hits(haystack, phrases)
  if (found === 0) return 0
  return Math.min(HIT_CEIL, HIT_BASE + (found - 1) * HIT_STEP)
}

function rank(scores: Map<string, number>, axis: Axis): Suggestion[] {
  return [...scores.entries()]
    .filter(([, score]) => score >= KEEP_ABOVE[axis])
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PER_AXIS[axis])
    .map(([tag, score]) => ({ axis, tag, score: Math.round(score * 100) / 100 }))
}

function bump(scores: Map<string, number>, tag: string, amount: number): void {
  scores.set(tag, Math.min(1, (scores.get(tag) ?? 0) + amount))
}

// ------------------------------------------------------------------- hook

/** The opening words are the hook; classify how they work. */
function hookSuggestions(input: TagInput): Suggestion[] {
  const scores = new Map<string, number>()
  const opening = lower(input.firstLine ?? '')
  const words = opening.replace(/[^\p{L}\p{N}'\s?]/gu, ' ').split(/\s+/).filter(Boolean)
  const spoken = spokenWords(input.plain)
  const silent = spoken.split(/\s+/).filter(Boolean).length < SILENT_WORDS

  if (silent) {
    // Nothing is said, so the opening is carried by on-screen text or by audio
    // somebody else made.
    bump(scores, 'text-claim', 0.6)
    if ((input.durationSec ?? 99) <= SHORT_CLIP_SEC) bump(scores, 'trending-audio', 0.5)
    return rank(scores, 'hook')
  }

  if (opening.includes('?') || (HOOK_WORDS.question as readonly string[]).includes(words[0] ?? '')) {
    bump(scores, 'question', 0.9)
  }
  if (hits(opening, [...HOOK_WORDS.contrast])) bump(scores, 'contrast', 0.85)
  if (hits(opening, [...HOOK_WORDS.transition])) bump(scores, 'transition', 0.85)
  if (words.slice(0, 6).some((word) => (HOOK_WORDS.address as readonly string[]).includes(word))) {
    bump(scores, 'direct-address', 0.8)
  }
  if ((HOOK_WORDS.midThought as readonly string[]).includes(words[0] ?? '')) {
    bump(scores, 'in-media-res', 0.7)
  }
  if (words.length <= 3) bump(scores, 'text-claim', 0.5)

  // A first-person statement with no lead-in is exactly "drops mid-scene, no
  // setup" — it is a real opening, not an absent one, so it should not fall
  // through to `none`.
  if (scores.size === 0 && (HOOK_WORDS.firstPerson as readonly string[]).includes(words[0] ?? '')) {
    bump(scores, 'in-media-res', 0.55)
  }

  if (scores.size === 0) bump(scores, 'none', 0.45)
  return rank(scores, 'hook')
}

// ----------------------------------------------------------------- format

function formatSuggestions(input: TagInput): Suggestion[] {
  const scores = new Map<string, number>()
  const text = `${lower(spokenWords(input.plain))} ${lower(input.caption)}`

  for (const [tag, phrases] of Object.entries(FORMAT_WORDS)) {
    const score = keywordScore(text, phrases)
    if (score > 0) bump(scores, tag, score)
  }

  // Shape of the recording, which the words alone do not reveal.
  const words = spokenWords(input.plain).split(/\s+/).filter(Boolean).length
  const speakers = input.speakerCount ?? 0
  if (words < SILENT_WORDS) {
    bump(scores, 'text-overlay', 0.6)
    if ((input.durationSec ?? 99) <= SHORT_CLIP_SEC) bump(scores, 'thirst-trap', 0.5)
  } else if (speakers >= 2) {
    bump(scores, 'skit', 0.55)
    if (scores.has('street-interview')) bump(scores, 'street-interview', 0.2)
  } else if (words >= 25) {
    bump(scores, 'talking-head', 0.6)
  }

  return rank(scores, 'format')
}

// ---------------------------------------------------------------- persona

function personaSuggestions(input: TagInput): Suggestion[] {
  // Persona is a property of the creator, so a confirmed one carries over
  // rather than being re-guessed from a single clip.
  if (input.creatorPersona?.length) {
    return input.creatorPersona
      .slice(0, MAX_PER_AXIS.persona)
      .map((tag) => ({ axis: 'persona' as const, tag, score: 1 }))
  }

  const scores = new Map<string, number>()
  const text = input.creatorText
    ? lower(spokenWords(input.creatorText))
    : `${lower(spokenWords(input.plain))} ${lower(input.caption)}`

  for (const [tag, phrases] of Object.entries(PERSONA_WORDS)) {
    const score = keywordScore(text, phrases)
    if (score > 0) bump(scores, tag, score)
  }
  return rank(scores, 'persona')
}

/** Every suggestion for one video, across all three axes. */
export function suggestTags(input: TagInput): Suggestion[] {
  return [...personaSuggestions(input), ...formatSuggestions(input), ...hookSuggestions(input)]
}

/** The opening line of a transcript, which is what the hook rules read. */
export function firstLineOf(blocks: unknown, plain: string): string | null {
  if (Array.isArray(blocks) && blocks.length > 0) {
    const text = (blocks[0] as { text?: unknown }).text
    if (typeof text === 'string' && text.trim()) return text.trim()
  }
  const sentence = spokenWords(plain).split(/(?<=[.!?])\s/)[0]
  return sentence?.trim() || null
}
