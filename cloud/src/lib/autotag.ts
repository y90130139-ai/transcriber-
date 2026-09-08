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

/** One reading of the screen: when it appeared, and what it said. */
export type OnScreenCaption = { t?: number | null; text?: string | null }

export type TagInput = {
  plain: string
  caption: string | null
  /** The opening line, which is the hook. */
  firstLine: string | null
  /** Text burned into the frame, read on-device by the Mac's visual pass.
   *  For a video nobody speaks in this is the only opening there is: measured
   *  2026-09-06, 44 of the 50 silent folders on the Mac (88%) carry it, and
   *  before this they all fell through to the same placeholder `text-claim`.
   *  Deliberately NOT fed to persona — see personaSuggestions. */
  onScreenText?: string | null
  /** The same on-screen text, still split into the beats it was read in.
   *  `on_screen_text` joins them for search; the structure is what says whether
   *  a caption is one statement or a setup and a punchline, so the comparison
   *  shape is read from here rather than by re-splitting the joined string. */
  onScreenCaptions?: OnScreenCaption[] | null
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

/** A closing beat longer than this is a sentence, not a punchline. Six is
 *  measured, not chosen: `BAK "how lazy are you?" me:` is six words and is the
 *  shape; `It's all concentrated in one spot..` is also six and is not, which
 *  is why the person test below carries the decision and this only bounds it. */
const PUNCHLINE_WORDS = 6

/** Above `question`'s 0.9, because the whole point is that it outranks it.
 *  Only one hook tag survives `rank`, so a tie would keep the wrong one. */
const COMPARISON_SCORE = 0.95

/** Between `question`'s 0.9 and `COMPARISON_SCORE`, and the order is the whole
 *  point. It has to beat `question`, because `when he's snatching your soul`
 *  opens on a question word and answers nothing — 8 captions in the library are
 *  filed as questions on exactly that. It must lose to a comparison, because
 *  `Me: Are you sure it's 18 cm?` / `How he measured it:` opens on a POV
 *  subject and is still a two-beat comparison; the beat shape is the stronger
 *  evidence and phase 7 is what established that. */
const POV_SCORE = 0.92

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
export function mentions(haystack: string, phrase: string): boolean {
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

/** Two beats where the second one is a short answer about a person.
 *
 *  `how normal people cross their legs:` / `me:` and `Women showing basic
 *  communication skills and empathy` / `Men: Sex?` are both comparisons, and
 *  both used to come back `hook:question` — the first because `how` opens the
 *  question lexicon, the second because its punchline ends in a question mark.
 *  The setup is a decoy in this shape: what makes it a comparison is that the
 *  caption turns and lands on a person, whatever it opened with.
 *
 *  Both halves of the test are load-bearing. Length alone would take
 *  `Honorable mention:` off the end of a listicle; a person word alone would
 *  take a closing sentence that happens to say `I'm`. Speech never reaches
 *  here — a transcript arrives as one string with no beats — so this reads the
 *  screen only, and leaves spoken hooks exactly where they were.
 */
function isComparison(beats: string[]): boolean {
  if (beats.length < 2) return false
  const closing = beats[beats.length - 1] ?? ''
  const words = closing.replace(/[^\p{L}\p{N}'\s]/gu, ' ').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length > 0 && words.length <= PUNCHLINE_WORDS
      && words.some((word) => (HOOK_WORDS.selfReference as readonly string[]).includes(word))) {
    return true
  }
  return isLabelledTurn(beats)
}

/**
 * `Him: \u201CI have a surprise for you\u201D` / `The surprise:` — a setup and its
 * reveal, each one announced by a label rather than by naming a person, so
 * `selfReference` above never sees it.
 *
 * Restricted to a caption of exactly two beats, which is what keeps it off a
 * listicle: `5 meals I\u2019d cook for you\u2026` closes on `Honorable mention:` and
 * is a colon-labelled beat too, but it arrives as five beats and is not a
 * comparison. Two labels and nothing between them is the shape.
 */
function isLabelledTurn(beats: string[]): boolean {
  if (beats.length !== 2) return false
  return beats.every((beat) => /\S:(\s|$)/.test(beat.trim()))
}

/** A word being used as a verb rather than as a noun that happens to end -ing. */
function isGerund(word: string): boolean {
  return word.length > 4 && word.endsWith('ing')
    && !(HOOK_WORDS.notGerunds as readonly string[]).includes(word)
}

/** An opening that names a scenario instead of asserting or asking anything.
 *
 *  `POV: Me when boredom strikes`, `when he thinks it's just really wet`,
 *  `Me watching the slideshow Apple made` — the viewer is being handed a
 *  situation and invited to recognise it. There is no claim to agree with and
 *  no question to answer, which is why neither `text-claim` nor `question`
 *  describes it, and why 28 of these sat on the `text-claim` placeholder while
 *  8 more were filed as questions they never ask.
 *
 *  Three ways in, because the shape is announced three ways:
 *  the label itself; a `when` clause; or a person caught mid-action.
 */
function isScenario(words: string[], opening: string): boolean {
  const first = words[0] ?? ''
  if ((HOOK_WORDS.povLabel as readonly string[]).includes(first)) return true

  const subject = (HOOK_WORDS.povSubject as readonly string[]).includes(first)

  // `when he …` and `me when …`. A question mark means the caption really is
  // asking something — `"What do you do when he doesn't reply?"` is a question
  // that happens to contain the word, and belongs to `question`.
  if (!opening.includes('?')) {
    const at = words.indexOf('when')
    if (at === 0 || (at === 1 && subject)) return true
  }

  // `me watching …`, `my boss seeing …`. Within three words of the subject,
  // because the person is sometimes named before the verb arrives.
  return subject && words.slice(1, 4).some(isGerund)
}

/** Classify an opening, whether it was spoken or stamped on the frame.
 *
 *  Split out of hookSuggestions so on-screen text is judged by exactly the same
 *  rules as speech — a question is a question whether she asks it or types it.
 */
function classifyOpening(
  opening: string,
  scores: Map<string, number>,
  beats: string[] = [],
): void {
  const words = opening.replace(/[^\p{L}\p{N}'\s?]/gu, ' ').split(/\s+/).filter(Boolean)

  if (opening.includes('?') || (HOOK_WORDS.question as readonly string[]).includes(words[0] ?? '')) {
    bump(scores, 'question', 0.9)
  }
  if (hits(opening, [...HOOK_WORDS.contrast])) bump(scores, 'contrast', 0.85)
  if (isComparison(beats)) bump(scores, 'contrast', COMPARISON_SCORE)
  if (hits(opening, [...HOOK_WORDS.transition])) bump(scores, 'transition', 0.85)
  if (words.slice(0, 6).some((word) => (HOOK_WORDS.address as readonly string[]).includes(word))) {
    bump(scores, 'direct-address', 0.8)
  }
  if ((HOOK_WORDS.midThought as readonly string[]).includes(words[0] ?? '')) {
    bump(scores, 'in-media-res', 0.7)
  }
  if (isScenario(words, opening)) bump(scores, 'pov-relatable', POV_SCORE)
  if (words.length <= 3) bump(scores, 'text-claim', 0.5)

  // A first-person statement with no lead-in is exactly "drops mid-scene, no
  // setup" — it is a real opening, not an absent one, so it should not fall
  // through to `none`.
  if (scores.size === 0 && (HOOK_WORDS.firstPerson as readonly string[]).includes(words[0] ?? '')) {
    bump(scores, 'in-media-res', 0.55)
  }
}

/** The opening words are the hook; classify how they work. */
function hookSuggestions(input: TagInput): Suggestion[] {
  const scores = new Map<string, number>()
  const spoken = spokenWords(input.plain)
  const silent = spoken.split(/\s+/).filter(Boolean).length < SILENT_WORDS
  const screen = lower(input.onScreenText ?? '').trim()
  // The beats as they were read, so the shape of the caption survives the join.
  const beats = (input.onScreenCaptions ?? [])
    .map((caption) => lower(caption?.text ?? '').trim())
    .filter(Boolean)

  if (silent) {
    // Nothing is said, so the opening is carried by on-screen text or by audio
    // somebody else made. When the screen actually said something, read it —
    // otherwise every silent video in the library lands on the same
    // placeholder and the hook axis tells you nothing about any of them.
    if (screen) {
      classifyOpening(screen, scores, beats)
      // It is still a claim made in text rather than spoken, so the format of
      // the hook holds even once we know what it says.
      bump(scores, 'text-claim', 0.6)
      return rank(scores, 'hook')
    }
    bump(scores, 'text-claim', 0.6)
    if ((input.durationSec ?? 99) <= SHORT_CLIP_SEC) bump(scores, 'trending-audio', 0.5)
    return rank(scores, 'hook')
  }

  classifyOpening(lower(input.firstLine ?? ''), scores)
  if (scores.size === 0) bump(scores, 'none', 0.45)
  return rank(scores, 'hook')
}

// ----------------------------------------------------------------- format

function formatSuggestions(input: TagInput): Suggestion[] {
  const scores = new Map<string, number>()
  // On-screen text joins the format haystack: `POV:`, `GRWM`, `story time`
  // and the rest are stamped on the frame at least as often as they are said.
  const text = `${lower(spokenWords(input.plain))} ${lower(input.caption)} ${lower(input.onScreenText)}`

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
  // On-screen text is deliberately absent here. Persona is a claim about a
  // person and needs two hits to stick; OCR returns watermarks, other people's
  // handles, storefront overlays and outright non-words (`syd | ryd | eyd` came
  // off a real reel), which is the worst possible evidence for who someone is.
  // It feeds hook and format only.
  const text = input.creatorText
    ? lower(spokenWords(input.creatorText))
    : `${lower(spokenWords(input.plain))} ${lower(input.caption)}`

  for (const [tag, phrases] of Object.entries(PERSONA_WORDS)) {
    const score = keywordScore(text, phrases)
    if (score > 0) bump(scores, tag, score)
  }
  return rank(scores, 'persona')
}

export type PersonaProposal = { tag: string; score: number; phrases: string[] }

/**
 * What one creator's whole shelf suggests about their persona, and the words
 * that suggested it.
 *
 * Only 44 of 166 items in the library carry a persona tag, and three creators
 * with 37 posts between them have none at all. The consequence is bigger than a
 * weak FIT score: format tags author the brief, and an item with no tags briefs
 * generically — four default lines on a card a creator actually reads.
 *
 * This exists so that gap can be closed per creator rather than per item, which
 * is the level a persona is actually true at. It proposes exactly what
 * `personaSuggestions` would propose from the same text — same lexicon, same
 * threshold, same cap — and additionally returns the phrases that fired, because
 * a persona is a claim about a person and approving one without seeing the
 * evidence is not approval, it is a rubber stamp.
 *
 * It writes nothing. Only a human's approval does.
 */
export function personaProposal(creatorText: string): PersonaProposal[] {
  const text = lower(spokenWords(creatorText))
  const scores = new Map<string, number>()
  const found = new Map<string, string[]>()

  for (const [tag, phrases] of Object.entries(PERSONA_WORDS)) {
    const matched = phrases.filter((phrase) => mentions(text, phrase))
    if (matched.length === 0) continue
    bump(scores, tag, Math.min(HIT_CEIL, HIT_BASE + (matched.length - 1) * HIT_STEP))
    found.set(tag, matched)
  }

  return rank(scores, 'persona').map((suggestion) => ({
    tag: suggestion.tag,
    score: suggestion.score,
    phrases: found.get(suggestion.tag) ?? [],
  }))
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
