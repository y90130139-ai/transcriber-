/**
 * The library's own captions — what real creators actually typed under reels
 * that worked — as the raw material for hers.
 *
 * The caption engine used to invent captions from the manual's five formulas.
 * Geno, 2026-09-23: they read like nobody on Instagram writes, when the
 * library already holds 777 real captions, most of them short, lowercase,
 * Gen Z and proven ("would u catch me if i fell?", "Lmk", "almost fell😱").
 * So captions start here now, ranked by how far their reel beat its own
 * creator's usual views, and the writer only adapts them to her.
 */
import { sql } from './db'
import { SIGNALS_COLUMNS, SIGNALS_JOIN } from './appeal'

export type BankCaption = {
  /** Cleaned, ready to adapt. */
  text: string
  /** The reel's plays over its creator's median — the library's own reach. */
  reach: number | null
  handle: string
  formats: string[]
  topic: string | null
}

/** Long captions are essays, promos or lyrics — nothing she would type
 *  under a reel. The library's best are well under this. */
const MAX_CHARS = 110

/** Captions that sell, credit or redirect. Useless to borrow. */
const PROMO = /\b(link in (my )?bio|subscribe|follow (me|for)|dm me|onlyfans|promo|discount code|giveaway|via|credits?|repost|tiktok|youtube|snap(chat)?|full video)\b/i

/** Letters and everyday words English does not have — Portuguese, Spanish,
 *  French, Italian — enough to catch a caption, not a full language check. */
const NOT_ENGLISH = /[ãõçñœ¿¡]|\b(não|meu|minha|você|que|muy|pero|porque|está|mais|com|una|los|las|del|pour|avec|c'est|questo|sono)\b/i

/** Below this a reel did no better than its creator usually does, so its
 *  caption proves nothing. */
export const PROVEN_REACH = 2

/**
 * What she could actually borrow from a caption, or null.
 *
 * Hashtags, mentions and links are the creator's, not the caption's. Most
 * captions are one line then a block of tags, so the first real line is the
 * caption.
 */
export function cleanCaption(raw: string): string | null {
  const lines = raw
    .split(/\n+/)
    .map((line) => line
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[#@][\p{L}\p{N}_.]+/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter((line) => /\p{L}/u.test(line))
  let text = lines[0] ?? ''
  if (text.length > MAX_CHARS) {
    const sentence = /^.+?[.!?](\s|$)/.exec(text)
    text = sentence ? sentence[0].trim() : ''
  }
  if (!text || text.length > MAX_CHARS || PROMO.test(text)) return null
  // Her audience reads English; a Cyrillic or Hangul caption is not hers to
  // borrow, and nor is a Portuguese one that happens to use the same alphabet
  // ("Meu marido não acredita em mim" reached Magnus's week, 2026-09-25).
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.some((ch) => !/\p{Script=Latin}/u.test(ch))) return null
  if (NOT_ENGLISH.test(text)) return null
  return text
}

/** Every usable caption in the library, best reach first. One query per week
 *  written — 777 rows is nothing, and ranking in SQL would repeat appeal.ts. */
export async function loadBank(): Promise<BankCaption[]> {
  const rows = await sql.query(
    `select t.caption, lower(coalesce(sg.handle, t.author, '')) as handle, ${SIGNALS_COLUMNS},
            coalesce((select array_agg(g.tag) from transcriber.tags g
                       where g.job_id = t.job_id and g.axis = 'format'), '{}') as formats,
            (select g.tag from transcriber.tags g
              where g.job_id = t.job_id and g.axis = 'topic' limit 1) as topic
       from transcriber.transcripts t
       ${SIGNALS_JOIN}
      where coalesce(t.caption, '') <> ''`,
  )
  const seen = new Set<string>()
  const bank: BankCaption[] = []
  for (const row of rows) {
    const text = cleanCaption(String(row.caption))
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const plays = Number(row.sig_plays)
    const median = Number(row.sig_median_plays)
    bank.push({
      text,
      reach: plays > 0 && median > 0 ? Math.round((plays / median) * 10) / 10 : null,
      handle: String(row.handle ?? ''),
      formats: (row.formats as string[]) ?? [],
      topic: row.topic ? String(row.topic) : null,
    })
  }
  // Proven first; a caption whose reel we never measured goes after every one
  // we did, not in among them.
  return bank.sort((a, b) => (b.reach ?? -1) - (a.reach ?? -1))
}

/** A subject gate, same rule as matching: a golf caption only reaches a golf
 *  reel, and `relatable` or untagged captions reach anything. */
export function topicFits(caption: BankCaption, topic: string | null): boolean {
  if (!caption.topic || caption.topic === 'unknown' || caption.topic === 'relatable') return true
  return caption.topic === topic
}
