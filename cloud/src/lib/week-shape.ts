/**
 * What her week looks like once it has been tidied for reading — the same for
 * every model, every week, on every load.
 *
 * Susanna, 2026-09-27, after reviewing all 50 of her cards:
 *   - "some captions don't have any sense" — the line she was asking about was
 *     not a caption at all. It was the screen-text reader's misread of the
 *     reference ("Bal al", "and ORA", a shop's phone number) shown as the
 *     video's opening line. `readableLine` keeps those off her card.
 *   - "It would be much easier if you already had captions prepared for each
 *     video" — 0 of her 50 cards had any. `fillCaptions` gives every card 2–4
 *     real captions: the reel's own first (written for exactly that video),
 *     then proven ones from the library for the same kind of video.
 *   - The last 20 cards were her own Instagram videos, several of them the
 *     same clip reposted, and they read like assignments. `shapeWeek` marks
 *     her own reels (any of her accounts) so the page can put them in their
 *     own section, and folds repeats of one clip into one.
 *   - Couple videos, the third time of asking. `needsOthers` cards are hidden
 *     from a model who films solo unless she has already taken them on.
 *
 * Pure and import-free: the server shapes, her page renders, and the rules
 * can be tested without a database.
 */

export type ShapeCaption = { formula: string; caption: string; baits: string; from?: string }

export type ShapeInput = {
  id: string
  bucket: string | null
  hook: string | null
  on_screen_captions: { t?: number | null; text?: string | null }[] | null
  caption_options: ShapeCaption[] | null
  /** Who posted the reference, lowercased, no @. */
  author: string | null
  /** The reference's own caption, already cleaned (`cleanCaption`), or null. */
  source_caption: string | null
  duration_sec: number | null
  formats: string[]
  topic: string | null
  needs_others: boolean
  verdict: 'accepted' | 'declined' | 'open'
  filmed: boolean
  messages: unknown[]
}

export type Shaped = {
  /** One of her own reels, put on the week by hand rather than by the
   *  planner. Shown in their own section, not as assignments. */
  mine: boolean
  /** Another copy of a reel already on this week. Not shown. */
  duplicate: boolean
  /** Needs someone else on camera, and she films solo. Not shown. */
  hidden: boolean
}

/** A bank caption as `fillCaptions` needs it. */
export type BankLine = { text: string; reach: number | null; formats: string[]; topic: string | null }

/** Captions per card: at least this many whenever the library can supply
 *  them, never more than the most. */
export const MIN_CAPTIONS = 2
export const MAX_CAPTIONS = 4
/** Below this a reel did no better than its creator's usual, so its caption
 *  proves nothing. Same bar as `caption-bank.ts`. */
const PROVEN = 2

const WORD = /\p{L}{3,}/gu

/**
 * A line of on-screen text that a person could read, or null.
 *
 * The screen-text reader misreads shop signs, watermarks and half-frames:
 * "Bal al", "211", "and | ORA", "CALL US! +34 644727452". Those were shown to
 * her as the reel's hook, which is where "is this caption correct?" came from.
 * A readable line has at least two real words and eight letters, is mostly
 * letters, and carries no phone number.
 */
export function readableLine(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = trimSigns(raw.split('|').map((part) => part.trim()).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim())
  if (!text) return null
  // Nothing but capitals and under three real words is a sign, not a line:
  // "COLON BEACH". An all-caps overlay with a sentence in it survives.
  if (!/\p{Ll}/u.test(text) && (text.match(WORD) ?? []).length < 3) return null
  if (/\+?\d[\d\s-]{6,}\d/.test(text)) return null
  const letters = (text.match(/\p{L}/gu) ?? []).length
  const words = text.match(WORD) ?? []
  if (letters < 8 || words.length < 2) return null
  const visible = text.replace(/\s/g, '').length
  if (visible === 0 || letters / visible < 0.6) return null
  return text
}

const KEEP_SHORT = /^(I|a|A|I'm|I’m)$/

/**
 * A sign caught at the edge of the frame, read into the start or end of the
 * line: "KAYAST Signs you're in your peace era", "2100 $200 $500 It's getting
 * expensive", "ar COLON BEACH O". Off the front: tokens with no letters, one-
 * or two-letter scraps, and a capitals-only word right before a sentence
 * starts. Off the end: single-letter scraps.
 */
function trimSigns(text: string): string {
  const tokens = text.split(' ')
  const noise = (token: string, next: string | undefined) => {
    if (!/\p{L}/u.test(token)) return true
    const letters = token.replace(/[^\p{L}]/gu, '')
    if (letters.length <= 2 && !KEEP_SHORT.test(token) && !/[:!?]$/.test(token)) return true
    return /^\p{Lu}{2,}$/u.test(letters) && !/:$/.test(token) && Boolean(next && /^\p{Lu}\p{Ll}/u.test(next))
  }
  while (tokens.length > 1 && noise(tokens[0], tokens[1])) tokens.shift()
  // Off the end: a lone letter, or a capitals-only word after a sentence in
  // ordinary case ("…finally sends a sign RIPCUR" — a logo on a shirt).
  const trailing = (token: string, before: string | undefined) =>
    (/^\p{L}$/u.test(token) && !KEEP_SHORT.test(token))
    || (/^\p{Lu}{2,}$/u.test(token) && Boolean(before && /\p{Ll}/u.test(before)))
  while (tokens.length > 1 && trailing(tokens[tokens.length - 1], tokens[tokens.length - 2])) tokens.pop()
  return tokens.join(' ')
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)
    .filter((word) => word.length > 3)
}

/** Whether two captions are the same line give or take a typo ("way to hot"
 *  and "way too hot"). Short words are dropped, so spelling slips vanish. */
export function sameLine(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const wa = new Set(wordsOf(a))
  const wb = new Set(wordsOf(b))
  if (wa.size === 0 || wb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase()
  let shared = 0
  for (const word of wa) if (wb.has(word)) shared += 1
  return shared / Math.min(wa.size, wb.size) >= 0.6
}

/** Two of her reels are one clip posted twice when they run the same length
 *  to the hundredth of a second and say the same thing (or one says nothing).
 *  Length alone is not enough: two different reels cut to one template share
 *  it, and both stay. */
function sameClip(a: ShapeInput, b: ShapeInput): boolean {
  if (a.duration_sec === null || b.duration_sec === null) return false
  if (Math.abs(a.duration_sec - b.duration_sec) > 0.05) return false
  if (!a.source_caption || !b.source_caption) return true
  return sameLine(a.source_caption, b.source_caption)
}

/** Something she did on the card, which makes it hers to keep seeing. */
function touched(item: ShapeInput): boolean {
  return item.verdict === 'accepted' || item.filmed || item.messages.length > 0
}

/** Which copy of a repeated clip stays: the one she answered — yes or no —
 *  so a clip she already turned down never comes back as unanswered. */
function answered(item: ShapeInput): boolean {
  return touched(item) || item.verdict === 'declined'
}

/**
 * Which cards are hers, which repeat, which she will never film alone.
 *
 * `ownHandles` are every account of hers, lowercased — Susanna's own reels
 * were posted from her second account, so matching only `models.handle` found
 * none of the 22.
 */
export function shapeWeek(items: ShapeInput[], ownHandles: string[], solo: boolean): Shaped[] {
  const own = new Set(ownHandles.map((handle) => handle.toLowerCase().replace(/^@/, '')))
  const kept: ShapeInput[] = []
  const shaped = items.map((item): Shaped => {
    // A planner card on her own reel (reskin, iteration, repurpose) is an
    // assignment on purpose. Only the ones added as plain library cards move.
    const mine = !item.bucket && Boolean(item.author && own.has(item.author.toLowerCase()))
    // Only unanswered ones fold away. One she turned down stays hers to see,
    // in "Videos you can't do", where she can add it back.
    return { mine, duplicate: false, hidden: solo && item.needs_others && !answered(item) }
  })
  // Repeats of her own clips: keep the copy she has done something with, else
  // the first. Anything she has touched is never folded away.
  const order = items.map((item, index) => index)
    .filter((index) => shaped[index].mine)
    .sort((a, b) => Number(answered(items[b])) - Number(answered(items[a])) || a - b)
  for (const index of order) {
    const item = items[index]
    if (kept.some((other) => sameClip(other, item)) && !answered(item)) shaped[index].duplicate = true
    else kept.push(item)
  }
  return shaped
}

/**
 * The line shown as the reel's opening, only if a person could read it.
 * Screen text first-to-last, filtered the same way.
 */
export function cleanHook(item: Pick<ShapeInput, 'hook' | 'on_screen_captions'>): {
  hook: string | null
  on_screen_captions: ShapeInput['on_screen_captions']
} {
  const screen = item.on_screen_captions
    ?.map((line) => ({ ...line, text: readableLine(line.text) }))
    .filter((line) => line.text) ?? null
  return { hook: readableLine(item.hook), on_screen_captions: screen && screen.length ? screen : null }
}

/**
 * Real captions for every card that has none, the whole week at once so no
 * library caption lands on two cards.
 *
 * In order: the reference's own caption (written for exactly this video, so
 * it always makes sense under it); then library captions from reels of the
 * same kind that beat their creator's usual views, on the same subject or on
 * none in particular. Nothing that names the wrong person for her
 * (`wrong`), nothing repeated. Cards the caption engine has already written
 * are left exactly as they are.
 */
export function fillCaptions(
  items: Pick<ShapeInput, 'caption_options' | 'source_caption' | 'formats' | 'topic'>[],
  bank: BankLine[],
  wrong: RegExp,
): (ShapeCaption[] | null)[] {
  const used: string[] = items.flatMap((item) => item.caption_options?.map((option) => option.caption) ?? [])
  const taken = (line: string) => used.some((other) => sameLine(other, line) || other.toLowerCase() === line.toLowerCase())
  const fits = (line: BankLine, item: (typeof items)[number]) =>
    (!line.topic || line.topic === 'unknown' || line.topic === 'relatable' || line.topic === item.topic)
  // Proven first (the bank is sorted best reach first, unmeasured last). A
  // reel measured and found ordinary proves nothing and is left out; one never
  // measured is still a real caption someone posted, and goes after the rest.
  const proven = bank.filter((line) => (line.reach === null || line.reach >= PROVEN) && !wrong.test(line.text) && universal(line))

  // A card is topped up when it has fewer than the minimum — including one
  // the caption engine wrote a single line for. What is there stays first.
  const open = items.map((item) => (item.caption_options?.length ?? 0) < MIN_CAPTIONS)
  const outs: ShapeCaption[][] = items.map((item) => [...(item.caption_options ?? [])])
  const add = (out: ShapeCaption[], text: string, formula: string, upTo: number): boolean => {
    if (out.length >= upTo || taken(text)) return false
    used.push(text)
    out.push({ formula, caption: text, baits: '' })
    return true
  }
  // The reference's own caption first, on every card.
  items.forEach((item, index) => {
    if (open[index] && item.source_caption && !wrong.test(item.source_caption)) {
      add(outs[index], item.source_caption, 'the caption on the original', MAX_CAPTIONS)
    }
  })
  // Then in rounds, one caption per card per round, so the first card cannot
  // take the best three and leave the last one short. Same kind of video up to
  // the minimum, then any proven one on a subject that fits up to the minimum,
  // then same kind again up to three.
  const rounds: [upTo: number, sameKindOnly: boolean, formula: string][] = [
    [MIN_CAPTIONS, true, 'from a reel like this that did well'],
    [MIN_CAPTIONS, false, 'from a reel that did well'],
    [3, true, 'from a reel like this that did well'],
  ]
  for (const [upTo, sameKindOnly, formula] of rounds) {
    for (let progress = true; progress;) {
      progress = false
      items.forEach((item, index) => {
        if (!open[index] || outs[index].length >= upTo) return
        const line = proven.find((candidate) => fits(candidate, item) && !taken(candidate.text)
          && (!sameKindOnly || candidate.formats.some((f) => item.formats.includes(f))))
        if (line && add(outs[index], line.text, formula, upTo)) progress = true
      })
    }
  }
  // A long week can use every line that passes (Helwife's 36 cards, 2026-09-27).
  // Then a line may come round a second time rather than leave a card with one
  // option: the least used first, never twice on one card, and not on the
  // card next to one that already has it unless nothing else is left.
  const count = (text: string) => outs.reduce((n, out) => n + out.filter((o) => o.caption === text).length, 0)
  items.forEach((item, index) => {
    const captionsOf = (out: ShapeCaption[] | undefined) => (out ?? []).map((o) => o.caption)
    for (const avoidNeighbours of [true, false]) {
      if (!open[index] || outs[index].length >= MIN_CAPTIONS) return
      const avoid = new Set([...captionsOf(outs[index]),
        ...(avoidNeighbours ? [...captionsOf(outs[index - 1]), ...captionsOf(outs[index + 1])] : [])])
      const spare = proven.filter((line) => fits(line, item) && !avoid.has(line.text))
        .sort((a, b) => count(a.text) - count(b.text))
      for (const line of spare) {
        if (outs[index].length >= MIN_CAPTIONS) break
        outs[index].push({ formula: 'from a reel that did well', caption: line.text, baits: '' })
      }
    }
  })
  return items.map((item, index) => open[index] ? (outs[index].length ? outs[index] : null) : item.caption_options)
}

/** A comment prompt: a question, or a line that asks for an answer. */
const PROMPT = /\?|^(agree|be honest|tell me|rate|lmk|which|who else|am i|would (you|u)|pov:)/i
/** Someone in the original video that her video will not have. */
const POINTS_AT = /\b(he|she|him|her|his|hers|they|them|this (guy|girl|man|woman|tiktoker)|u guys)\b/i
/** Letters English does not use — a Portuguese or Spanish caption slipped
 *  past the bank's own check ("Você já passou por isso ?"). */
const FOREIGN = /[àáâãäåçèéêëìíîïñòóôõöùúûüýÿ]/i
const MAX_WORDS = 9
/** A thing in the original frame — its outfit, its colour, its golf course —
 *  that her video will not have. Read off the 128 captions that pass every
 *  other test (2026-09-27). */
const NAMES_A_THING = /\b(mousetrap|golf|sky|boat|beach|haircut|hair|neighbou?rs?|glass|pair|job|polka|hoodie|jumpsuits?|nuggets?|artist|temperature|weight|heels|form|footprint|body count|sundress|waisted|fix this|fit|wear|outfit|look|colou?r|pink|snack|dinner|eat|play|joke|morning|tomorrow|day)\b/i

/**
 * Whether a library caption reads naturally under a video it was not written
 * for. Susanna: "some captions don't have any sense" — a borrowed caption
 * that names the original's golf course, its cat, or "he" makes none under
 * hers. So a borrowed line must be a short question or prompt, with no names
 * (a capital after the first word, other than I), no digits, no third person,
 * and no subject of its own.
 */
export function universal(line: BankLine): boolean {
  const text = line.text.trim()
  const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word))
  if (!words.length || words.length > MAX_WORDS) return false
  if (!PROMPT.test(text) || POINTS_AT.test(text) || NAMES_A_THING.test(text) || FOREIGN.test(text) || /\d/.test(text)) return false
  if (words.slice(1).some((word) => /^\p{Lu}/u.test(word) && !/^I(['’]|$)/.test(word))) return false
  return !line.topic || line.topic === 'unknown' || line.topic === 'relatable'
}

/** Words in a caption that say the reel has a partner in it. Hashtags count:
 *  "#couples" is the creator saying so. "him" alone does not — a POV about a
 *  man is still filmed by one woman. */
export const COUPLE_WORDS = /(#couples?\b|#couplegoals|#relationship|\b(my|our) (boyfriend|girlfriend|husband|wife|hubby|bf|gf|man|partner)\b|\bcouples?\b|\bwith my (boyfriend|girlfriend|husband|wife|bf|gf|man)\b)/i

/**
 * Whether a reference needs someone else on camera.
 *
 * The library has no count of people in a frame, so this reads what it does
 * have: the account (one whose reels models have turned down as "needs another
 * person", or whose captions keep saying couple), the caption itself, and
 * three or more voices.
 */
export function needsOthers(input: {
  author: string | null
  rawCaption: string | null
  speakerCount: number | null
  formats: string[]
}, coupleAccounts: Set<string>): boolean {
  if (input.author && coupleAccounts.has(input.author.toLowerCase())) return true
  if (input.rawCaption && COUPLE_WORDS.test(input.rawCaption)) return true
  if (input.formats.includes('collab') || input.formats.includes('street-interview')) return true
  return (input.speakerCount ?? 0) >= 3
}
