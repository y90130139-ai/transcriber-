/**
 * Finding the one card she is talking about (Geno, 2026-10-11).
 *
 * She answers a card by its label — "V-87", or just "the gym mirror one" — and
 * until now that label was a dead end on our side: her cards run to V-130 and
 * spread over a dozen weeks, so the only way to reach the video she meant was
 * to open week after week and scroll. "We have to scroll through hundreds of
 * videos to see exactly what they're talking about."
 *
 * So: one search over everything she has ever been sent. Her whole history is
 * a hundred-odd rows, which is small enough to hold on the client and filter
 * on every keystroke — no round trip per letter, and an empty box is simply
 * her history, newest first.
 *
 * Pure and import-free, so the panel and the tests read one rule.
 */

export type FindableCard = {
  item_id: string
  plan_id: string
  /** The Monday of the week this card went out on — the sort key. */
  week_of: string
  /** What she calls it: `V-87`. Null on a card that never got a number. */
  card_no: number | null
  item_title: string | null
  /** The reference reel: who made it and what they called it. */
  author: string | null
  reel_title: string | null
  hook: string | null
  caption: string | null
  notes: string | null
  location: string | null
  wardrobe: string | null
  /** The opening of the reel's transcript — matched, but weakly. */
  preview: string | null
  model_note: string | null
  model_note_at: string | null
  decline_reason: string | null
  verdict: 'open' | 'accepted' | 'declined'
  filmed: boolean
  /** She said something nobody has read. The reason this panel exists. */
  unread: boolean
  has_thumb: boolean
  job_id: string | null
  webpage_url: string | null
}

export type CardQuery = {
  /** The number she quoted, if the query is one. */
  cardNo: number | null
  /** `V-87` or `#87` — she named a card, so nothing else can be meant. */
  explicit: boolean
  words: string[]
}

/** Phone-typed text, levelled: case folded and diacritics stripped, so `cafe`
 *  finds `Café` and `CAFÉ` finds it back. */
const flatten = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** How much a hit is worth, by where it landed. The card's own name and the
 *  creator's handle are how a card gets talked about; the transcript is the
 *  long tail, there so nothing is unreachable, weighted so it never wins. */
const FIELDS: { key: keyof FindableCard; weight: number }[] = [
  { key: 'item_title', weight: 100 },
  { key: 'author', weight: 90 },
  { key: 'reel_title', weight: 80 },
  // Her own words rank with the card's name: searching for what she said is
  // the whole point of the panel.
  { key: 'model_note', weight: 70 },
  { key: 'decline_reason', weight: 70 },
  { key: 'hook', weight: 50 },
  { key: 'caption', weight: 40 },
  { key: 'notes', weight: 40 },
  { key: 'location', weight: 35 },
  { key: 'wardrobe', weight: 30 },
  { key: 'preview', weight: 10 },
]

const CARD_PATTERN = /^(?:(v|#)\s*-?\s*)?(\d{1,5})$/

export function parseCardQuery(raw: string): CardQuery {
  const trimmed = flatten(raw).trim().replace(/\s+/g, ' ')
  if (!trimmed) return { cardNo: null, explicit: false, words: [] }

  const asCard = CARD_PATTERN.exec(trimmed.replace(/^v\s*-\s*/, 'v'))
  if (asCard) {
    return { cardNo: Number(asCard[2]), explicit: Boolean(asCard[1]), words: [asCard[2]] }
  }
  return { cardNo: null, explicit: false, words: trimmed.split(' ').filter(Boolean) }
}

/** What one card is worth against one query. `null` means it does not match —
 *  every word has to land somewhere, so a second word narrows the list instead
 *  of widening it. */
export function scoreCard(card: FindableCard, query: CardQuery): number | null {
  const onNumber = query.cardNo !== null && card.card_no === query.cardNo
  if (query.explicit) return onNumber ? NUMBER_BONUS : null

  let total = onNumber ? NUMBER_BONUS : 0
  for (const word of query.words) {
    let best = 0
    for (const field of FIELDS) {
      const value = card[field.key]
      if (typeof value === 'string' && flatten(value).includes(word)) {
        best = Math.max(best, field.weight)
      }
    }
    if (best === 0 && !onNumber) return null
    total += best
  }
  return total
}

/** A quoted number beats any amount of prose: the card actually called V-87 is
 *  never pushed below a caption that happens to say "87". */
const NUMBER_BONUS = 10_000

/** Her cards for one query, best first. An empty query is her history. */
export function findCards(cards: FindableCard[], raw: string): FindableCard[] {
  const query = parseCardQuery(raw)
  const scored: { card: FindableCard; score: number }[] = []
  for (const card of cards) {
    const score = query.words.length === 0 ? 0 : scoreCard(card, query)
    if (score !== null) scored.push({ card, score })
  }
  return scored
    .sort((a, b) =>
      b.score - a.score ||
      // Whoever is waiting on an answer comes first.
      Number(b.card.unread) - Number(a.card.unread) ||
      b.card.week_of.localeCompare(a.card.week_of) ||
      (b.card.card_no ?? 0) - (a.card.card_no ?? 0))
    .map((entry) => entry.card)
}

/**
 * The part of a long note the search actually matched, with a little either
 * side. Her messages run to a paragraph; a result row has one line, and the
 * line worth showing is the one with the words in it.
 */
export function snippetAround(text: string, words: string[], length = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= length) return clean
  const flat = flatten(clean)
  let at = -1
  for (const word of words) {
    const found = flat.indexOf(word)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at <= 0) return `${clean.slice(0, length).trimEnd()}…`
  // Open a little before the hit so the match is not flush against the ellipsis.
  const from = Math.max(0, at - Math.floor(length / 4))
  const slice = clean.slice(from, from + length).trim()
  return `${from > 0 ? '…' : ''}${slice}${from + length < clean.length ? '…' : ''}`
}

/**
 * The card a `?card=` link points at: an item id, or the label she quoted
 * (`V-87`, `87`). Null when her history holds no such card — the panel then
 * opens on her history rather than pretending the link worked.
 */
export function cardForKey(cards: FindableCard[], key: string): FindableCard | null {
  const direct = cards.find((card) => card.item_id === key)
  if (direct) return direct
  const { cardNo } = parseCardQuery(key)
  if (cardNo === null) return null
  // The loader hands these over newest week first, so a number reused across
  // weeks resolves to the most recent one — the one being talked about now.
  return cards.find((card) => card.card_no === cardNo) ?? null
}
