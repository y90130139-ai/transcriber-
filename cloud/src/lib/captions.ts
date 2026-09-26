/**
 * The caption engine, written a week at a time from the library's own
 * captions.
 *
 * History, because this file has been three different things in one night
 * (2026-09-23):
 * - One call per card, inventing captions from the manual's five formulas.
 *   Magnus's 21 cards collapsed onto three shapes; 19 of 63 survived.
 * - One call for the whole week, then plan-the-week-then-write-each-card. More
 *   variety, but invented captions read like nobody on Instagram writes them —
 *   "Surprises surprise the surprised".
 * - Now: every caption starts as a REAL caption from the library, off a reel
 *   that beat its creator's usual views (`caption-bank.ts`). The writer's only
 *   job is to adapt it to her and to this video — keep the wording, the casing,
 *   the emoji, the rhythm — and to name the comment it draws. No source caption
 *   is used twice in a week, which is what keeps the week varied.
 *
 * The DM stays per card in `writer.ts`.
 */
import { sql } from './db'
import { WRITER_MODEL, STRONG_WRITER_MODEL, askJson } from './ai'
import { labelOf } from './taxonomy'
import { WHO } from './writer'
import { PROVEN_REACH, cleanCaption, loadBank, topicFits, type BankCaption } from './caption-bank'
import type { CaptionOption } from './plans'

const PER_CARD = 3
/** Real captions offered per card. Enough to choose three that fit. */
const OFFERED = 7
/** Cards written at once. Each is a short call; five at a time keeps a week
 *  of 21 inside a minute or two without hammering the allowance. */
const PARALLEL = 5
/** How much of the real caption must survive the adaptation. Below this the
 *  model has written its own line and only kept a word or two — which is the
 *  invented caption this file exists to stop. */
const KEEP_AT_LEAST = 0.4

/** Which model writes the captions. `strong` is gpt-oss-120b — readable where
 *  the free 70B wrote nonsense (2026-09-23 comparison), about 3 cents a week
 *  per model past the free allowance. */
export type CaptionModel = 'default' | 'strong'
const MODEL_OF: Record<CaptionModel, string> = { default: WRITER_MODEL, strong: STRONG_WRITER_MODEL }
/** A reasoning model spends tokens thinking before it answers, and they come
 *  out of the same budget. */
const THINKING_TOKENS: Record<CaptionModel, number> = { default: 0, strong: 2000 }
export const DEFAULT_CAPTION_MODEL: CaptionModel = 'strong'

/** Words that give away the wrong person. The prompt says who the creator is;
 *  this is what enforces it, because the prompt is advice. */
const WRONG_WORDS: Record<string, RegExp> = {
  woman: /\b(he|him|his|guy|guys|dude|man|men|boyfriend material)\b/i,
  man: /\b(she|her|hers|girl|girls|woman|women|ladies|queen)\b/i,
  'trans-woman': /\b(he|him|his|guy|dude|man|men)\b/i,
  'trans-man': /\b(she|her|hers|girl|girls|woman|women|ladies)\b/i,
  'non-binary': /\b(he|him|his|she|her|hers|girl|girls|guy|guys|woman|women|man|men)\b/i,
  unknown: /\b(he|him|his|she|her|hers|girl|girls|guy|guys|woman|women|man|men)\b/i,
}

/** A "baited" comment that is really praise. Nobody needs a caption to type
 *  "love this"; the manual's QC pass cuts exactly these. */
const PRAISE = /\b(love (this|it|you)|so (you|true|cute|pretty|hot)|killing it|slay|nailed|queen|obsessed|gorgeous|beautiful|stunning|yes girl|you go|amazing|perfect)\b/i

/** Filler that makes two different captions look alike, or two alike look
 *  different. Numbers go too: "2 reasons" and "3 reasons" are one caption. */
const FILLER = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'is', 'im', 'i', 'my', 'me', 'you', 'your', 'it', 'its', 'with', 'be', 'just', 'so'])

function wordsOf(caption: string): string[] {
  return caption.toLowerCase().replace(/[’']/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
}

/**
 * Whether two captions say the same thing to someone scrolling the week.
 *
 * The old test was exact shape after dropping digits, which let "2 reasons to
 * hang with me" and "3 reasons to hang with Magnus in Connecticut" both
 * through, and five "POV: your partner finally ___" with a different last
 * word. Same opening three words, or half their meaningful words shared, and
 * they are one caption.
 */
export function sameCaption(a: string, b: string): boolean {
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (wa.length >= 3 && wb.length >= 3 && wa.slice(0, 3).join(' ') === wb.slice(0, 3).join(' ')) return true
  const ca = new Set(wa.filter((w) => !FILLER.has(w)))
  const cb = new Set(wb.filter((w) => !FILLER.has(w)))
  if (ca.size === 0 || cb.size === 0) return false
  let shared = 0
  for (const w of ca) if (cb.has(w)) shared += 1
  return shared / Math.min(ca.size, cb.size) >= 0.5
}

/** How much of the real caption's own words made it into the adaptation. */
function retained(source: string, adapted: string): number {
  const from = new Set(wordsOf(source).filter((w) => !FILLER.has(w)))
  if (from.size === 0) return 1
  const into = new Set(wordsOf(adapted))
  let n = 0
  for (const w of from) if (into.has(w)) n += 1
  return n / from.size
}

type Card = {
  id: string
  position: number
  bucket: string | null
  axis: string | null
  reel: string
  hasCaptions: boolean
}

type Reel = {
  key: string
  label: string
  formats: string[]
  topic: string | null
  hook: string | null
  words: string
  title: string | null
  /** What was typed under the source reel itself, cleaned. For a re-shoot of
   *  her own winner, that is her own winning caption. */
  caption: string | null
}

type Creator = {
  name: string
  who: string
  creatorType: string
  handle: string
  persona: string[]
  place: string | null
  wontDo: string[]
}

export type WeekCaptionResult = {
  ok: boolean
  reason?: string
  cards: number
  captions: number
  short: number
  model?: CaptionModel
  /** Why calls to the model failed, if any did — distinct messages only. A
   *  run that writes nothing must say why rather than report zero quietly. */
  errors?: string[]
  /** Per card, what was kept — returned so a dry run can be read. */
  written?: { position: number; captions: CaptionOption[] }[]
}

/** What changes on a card, in the words the writer needs. */
function changeOf(card: Card): string {
  if (card.bucket === 'test') return 'a new idea built on this reel'
  if (!card.axis) return card.bucket === 'iteration' ? 'a fresh take on this reel' : 're-filmed exactly'
  if (card.axis === 'hook') return 'new opening line'
  if (card.axis === 'location') return 'new place'
  if (card.axis === 'outfit') return 'new outfit'
  if (card.axis === 'twist') return "the reel with the creator's own twist"
  return `new ${card.axis}`
}

async function load(planId: string): Promise<{ status: string; creator: Creator; cards: Card[]; reels: Reel[] } | null> {
  const [head] = await sql.query(
    `select p.status, m.name, m.handle, m.persona, m.place, m.wont_do, m.creator_type
       from transcriber.plans p join transcriber.models m on m.id = p.model_id
      where p.id = $1`,
    [planId],
  )
  if (!head) return null
  const rows = await sql.query(
    `select i.id, i.position, i.bucket, i.axis, i.hook, i.title, i.job_id,
            jsonb_array_length(coalesce(i.caption_options, '[]'::jsonb)) as captions,
            left(coalesce(t.plain, ''), 360) as words, t.caption as own_caption,
            coalesce((select array_agg(g.tag) from transcriber.tags g
                       where g.job_id = i.job_id and g.axis = 'format'), '{}') as formats,
            (select g.tag from transcriber.tags g
              where g.job_id = i.job_id and g.axis = 'topic' limit 1) as topic
       from transcriber.plan_items i
       left join transcriber.transcripts t on t.job_id = i.job_id
      where i.plan_id = $1
      order by i.position`,
    [planId],
  )

  // One entry per source reel: cards that re-film the same video point at it
  // rather than repeating it, which is both shorter and the whole point.
  const reels = new Map<string, Reel>()
  const cards: Card[] = rows.map((row) => {
    const key = row.job_id ? String(row.job_id) : `card:${row.id}`
    if (!reels.has(key)) {
      reels.set(key, {
        key,
        label: `R${reels.size + 1}`,
        formats: (row.formats as string[]) ?? [],
        topic: row.topic ? String(row.topic) : null,
        hook: row.hook ? String(row.hook) : null,
        words: String(row.words ?? '').replace(/\[\d+:\d+\]\s*/g, '').replace(/\s+/g, ' ').trim(),
        title: row.title ? String(row.title) : null,
        caption: row.own_caption ? cleanCaption(String(row.own_caption)) : null,
      })
    }
    return {
      id: String(row.id),
      position: Number(row.position),
      bucket: row.bucket ? String(row.bucket) : null,
      axis: row.axis ? String(row.axis) : null,
      reel: reels.get(key)!.label,
      hasCaptions: Number(row.captions) > 0,
    }
  })

  const creatorType = String(head.creator_type ?? 'unknown')
  return {
    status: String(head.status),
    cards,
    reels: [...reels.values()],
    creator: {
      name: String(head.name),
      who: WHO[creatorType] ?? WHO.unknown,
      creatorType,
      handle: String(head.handle ?? '').toLowerCase(),
      persona: ((head.persona as string[]) ?? []).map((tag) => labelOf('persona', tag)),
      place: head.place ? String(head.place) : null,
      wontDo: ((head.wont_do as string[]) ?? []).map((t) => labelOf('format', t)),
    },
  }
}

type Offer = { text: string; label: string }

/**
 * The real captions offered to one card, and taken off the table for every
 * other card this week.
 *
 * Her own caption on the source reel first — it already worked, for her. Then
 * the best-reaching captions from reels of the same format, then the best of
 * the rest, all through the subject gate.
 */
function offerFor(reel: Reel, bank: BankCaption[], taken: Set<string>, creator: Creator): Offer[] {
  const offers: Offer[] = []
  const take = (text: string, label: string) => {
    const key = text.toLowerCase()
    if (taken.has(key) || offers.length >= OFFERED) return
    taken.add(key)
    offers.push({ text, label })
  }
  if (reel.caption) take(reel.caption, 'the caption on the original')
  const fits = bank.filter((c) => topicFits(c, reel.topic))
  const labelOf = (c: BankCaption) => c.handle === creator.handle
    ? 'their own caption'
    : c.reach ? `from a reel at ${c.reach}x its creator's usual views` : 'from the library'
  // Proven first, always. A same-format caption only jumps the queue when its
  // own reel beat its creator's usual views; otherwise a 0.9x caption that
  // happened to share a format outranked a 200x one that did not (2026-09-25).
  const proven = fits.filter((c) => (c.reach ?? 0) >= PROVEN_REACH)
  for (const c of proven.filter((c) => c.formats.some((f) => reel.formats.includes(f)))) {
    if (offers.length >= OFFERED - 2) break
    take(c.text, labelOf(c))
  }
  for (const c of proven) {
    if (offers.length >= OFFERED) break
    take(c.text, labelOf(c))
  }
  // Only when the proven ones have all been used this week.
  for (const c of fits) {
    if (offers.length >= OFFERED) break
    take(c.text, labelOf(c))
  }
  return offers
}

function cardPrompt(creator: Creator, reel: Reel, card: Card, offers: Offer[], used: string[]): string {
  return [
    'You adapt REAL Instagram captions for one creator. You do not write captions from scratch.',
    'Return ONLY a JSON object:',
    '{"captions": [{"from": 1, "caption": "...", "baits": "..."}]}',
    '',
    'CREATOR',
    `- ${creator.who}`,
    creator.persona.length ? `- Persona: ${creator.persona.join(', ')}` : '',
    creator.place ? `- Where they are: ${creator.place}` : '',
    creator.wontDo.length ? `- Never: ${creator.wontDo.join(', ')}` : '',
    '',
    'THIS VIDEO',
    `- ${reel.formats.map((t) => labelOf('format', t)).join(', ') || reel.title || 'general'}`,
    reel.hook ? `- Opens with: "${reel.hook.slice(0, 120)}"` : '',
    reel.words ? `- What is said: "${reel.words.slice(0, 300)}"` : '',
    `- This time: ${changeOf(card)}`,
    '',
    'REAL CAPTIONS, from reels that did well — numbered:',
    ...offers.map((o, i) => `${i + 1}. "${o.text}" (${o.label})`),
    '',
    `TASK: pick the ${PER_CARD} that best fit this video and this creator, and adapt each one.`,
    '- Keep its wording, length, casing, slang, punctuation and emoji. Change only what does not fit',
    '  this creator or this video: a wrong pronoun, a detail that is not in this video. Most need one or two words changed, some none.',
    '- Never make it longer, more formal or more "clever". Lowercase stays lowercase. No hashtags, no @mentions.',
    '- "from" is the number of the real caption you adapted.',
    '- "baits" is the exact comment a real stranger would type under it: a question, a disagreement,',
    '  tagging a friend, or "this is literally me". Never a compliment.',
    used.length ? 'Already used this week — do not end up saying any of these:\n' + used.map((u) => `- ${u}`).join('\n') : '',
  ].filter(Boolean).join('\n')
}

type Raw = { from?: unknown; caption?: unknown; baits?: unknown }

/** Keep what passes. Each card's answers checked against everything kept this
 *  week so far. */
function keep(
  raw: unknown,
  offers: Offer[],
  already: CaptionOption[],
  week: CaptionOption[],
  wrong: RegExp,
): CaptionOption[] {
  const out = [...already]
  const list = Array.isArray(raw) ? raw as Raw[] : []
  for (const entry of list) {
    if (out.length >= PER_CARD) break
    if (!entry || typeof entry !== 'object') continue
    const offer = offers[Number(entry.from) - 1]
    const caption = String(entry.caption ?? '').replace(/[#@][\p{L}\p{N}_.]+/gu, '').replace(/\s{2,}/g, ' ').trim().slice(0, 140)
    // A tag in the comment is a stranger's friend; the model invents one
    // ("tag @johnny"), so the handle goes and the words stay.
    const baits = String(entry.baits ?? '').replace(/@[\p{L}\p{N}_.]+/gu, '').replace(/\s{2,}/g, ' ').trim().slice(0, 140)
    if (!offer || !caption || !baits) continue
    if (PRAISE.test(baits) || wrong.test(caption)) continue
    // Adapted, not rewritten: most of the real caption has to still be there.
    if (retained(offer.text, caption) < KEEP_AT_LEAST) continue
    const all = [...week, ...out]
    if (all.some((k) => k.from === offer.text || sameCaption(k.caption, caption))) continue
    // The same comment twice in a week is one comment. Near-identical only:
    // two comments that both mention phones are still two comments.
    const bait = wordsOf(baits).join(' ')
    if (all.some((k) => wordsOf(k.baits).join(' ') === bait)) continue
    out.push({ formula: offer.label, caption, baits, from: offer.text })
  }
  return out
}

export type WeekCaptionOptions = { rewrite?: boolean; model?: CaptionModel; dry?: boolean }

/**
 * Write captions for a whole week from the library's real captions.
 *
 * `rewrite` replaces every card's captions; otherwise only cards with none are
 * written. A week that has been sent is never touched — she already has those
 * words. `dry` reports and stores nothing, for comparing runs.
 */
export async function writeWeekCaptions(planId: string, options: WeekCaptionOptions = {}): Promise<WeekCaptionResult> {
  const rewrite = options.rewrite === true
  const model = options.model ?? DEFAULT_CAPTION_MODEL
  const empty = { cards: 0, captions: 0, short: 0 }
  const week = await load(planId)
  if (!week) return { ok: false, reason: 'no such week', ...empty }
  if (week.status !== 'draft') return { ok: false, reason: 'this week has been sent; its captions stay as they got them', ...empty }

  const todo = week.cards.filter((c) => rewrite || !c.hasCaptions)
  if (!todo.length) return { ok: true, ...empty }

  const bank = await loadBank()
  if (!bank.length) return { ok: false, reason: 'the library has no usable captions', ...empty, cards: todo.length }
  const wrong = WRONG_WORDS[week.creator.creatorType] ?? WRONG_WORDS.unknown
  const reelOf = new Map(week.reels.map((r) => [r.label, r]))
  const errors = new Set<string>()

  // Captions already on cards this run is not replacing count as taken.
  const byCard = new Map<string, CaptionOption[]>()
  if (!rewrite) {
    const rows = await sql.query(
      `select caption_options from transcriber.plan_items where plan_id = $1 and caption_options is not null`, [planId],
    )
    byCard.set('old', rows.flatMap((r) => Array.isArray(r.caption_options) ? r.caption_options as CaptionOption[] : []))
  }
  const taken = new Set([...byCard.values()].flat().map((o) => (o.from ?? o.caption).toLowerCase()))

  // Two passes: the second offers fresh real captions to any card that came
  // out short.
  for (let pass = 0; pass < 2; pass += 1) {
    const cards = todo.filter((c) => (byCard.get(c.id)?.length ?? 0) < PER_CARD)
    if (!cards.length) break
    for (let i = 0; i < cards.length; i += PARALLEL) {
      const wave = cards.slice(i, i + PARALLEL)
      // Offers are handed out before the wave asks, so no two cards in it can
      // be given the same real caption.
      const offers = wave.map((card) => offerFor(reelOf.get(card.reel)!, bank, taken, week.creator))
      const used = [...byCard.values()].flat().map((o) => o.caption).slice(-40)
      const answers = await Promise.all(wave.map((card, n) => offers[n].length
        ? askJson<{ captions?: unknown }>(cardPrompt(week.creator, reelOf.get(card.reel)!, card, offers[n], used), {
            maxTokens: 400 + THINKING_TOKENS[model], temperature: 0.6, model: MODEL_OF[model],
          }).then((answer) => {
            if (!answer) errors.add('the model answered without usable JSON')
            return answer
          }).catch((error: unknown) => { errors.add(String(error).slice(0, 200)); return null })
        : Promise.resolve(null)))
      wave.forEach((card, n) => {
        const others = [...byCard.entries()].filter(([id]) => id !== card.id).flatMap(([, o]) => o)
        byCard.set(card.id, keep(answers[n]?.captions, offers[n], byCard.get(card.id) ?? [], others, wrong))
      })
    }
  }

  let captions = 0
  let short = 0
  const written: NonNullable<WeekCaptionResult['written']> = []
  for (const card of todo) {
    const mine = byCard.get(card.id) ?? []
    captions += mine.length
    if (mine.length < PER_CARD) short += 1
    written.push({ position: card.position, captions: mine })
    if (options.dry) continue
    // A rewrite replaces what was there even when it found nothing better —
    // keeping the old ones is how a bad run's captions survived before.
    if (!mine.length && !rewrite) continue
    await sql.query(
      `update transcriber.plan_items set caption_options = $2::jsonb where id = $1`,
      [card.id, mine.length ? JSON.stringify(mine) : null],
    )
  }
  return {
    ok: captions > 0,
    reason: captions === 0 && errors.size ? 'every call to the model failed' : undefined,
    cards: todo.length, captions, short, model, errors: [...errors], written,
  }
}
