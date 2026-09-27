/**
 * The database half of `week-shape.ts`: what the tidy-up needs to know about
 * her, the library and the week, fetched once per page load.
 *
 * Called only from `planItemsFor`, after its caller has settled which model
 * the plan belongs to. Nothing here is rendered from another model: the one
 * cross-roster read is every model's handles, used only to keep other models'
 * own captions off her cards.
 */
import { sql } from './db'
import { WRONG_WORDS } from './captions'
import { cleanCaption, loadBank, type BankCaption } from './caption-bank'
import { coupleAccounts, ownHandlesOf } from './solo'
import { cleanHook, fillCaptions, needsOthers, shapeWeek, type ShapeCaption, type ShapeInput } from './week-shape'

export type ShapeRow = {
  id: string
  job_id: string | null
  bucket: string | null
  hook: string | null
  on_screen_captions: ShapeInput['on_screen_captions']
  caption_options: ShapeCaption[] | null
  author: string | null
  raw_caption: string | null
  speaker_count: number | null
  duration_sec: number | null
  formats: string[]
  topic: string | null
  verdict: ShapeInput['verdict']
  filmed: boolean
  messages: unknown[]
}

export type ShapeResult = {
  hook: string | null
  on_screen_captions: ShapeInput['on_screen_captions']
  caption_options: ShapeCaption[] | null
  mine: boolean
  /** Folded away: a repeat of her own clip, or a couple reel she films solo. */
  drop: boolean
}

let bankCache: { at: number; bank: BankCaption[]; roster: Set<string> } | null = null
const BANK_MS = 10 * 60 * 1000

async function bankAndRoster(): Promise<{ bank: BankCaption[]; roster: Set<string> }> {
  if (bankCache && Date.now() - bankCache.at < BANK_MS) return bankCache
  const [bank, models] = await Promise.all([
    loadBank(),
    sql.query(`select handle, socials from transcriber.models`),
  ])
  const roster = new Set(models.flatMap((row) => ownHandlesOf(row.handle, row.socials)))
  bankCache = { at: Date.now(), bank, roster }
  return bankCache
}

export async function shapeRows(planId: string, rows: ShapeRow[]): Promise<ShapeResult[]> {
  if (!rows.length) return []
  const [head] = await sql.query(
    `select m.handle, m.socials, m.creator_type, coalesce(m.solo, true) as solo
       from transcriber.plans p join transcriber.models m on m.id = p.model_id where p.id = $1`,
    [planId],
  )
  const own = ownHandlesOf(head?.handle, head?.socials)
  const solo = head ? Boolean(head.solo) : true
  const wrong = WRONG_WORDS[String(head?.creator_type ?? 'unknown')] ?? WRONG_WORDS.unknown
  const [{ bank, roster }, couples] = await Promise.all([bankAndRoster(), coupleAccounts()])
  const mineSet = new Set(own)
  // Her own captions are hers to reuse; another model's are not ours to hand out.
  const usable = bank.filter((line) => !roster.has(line.handle) || mineSet.has(line.handle))

  const inputs: ShapeInput[] = rows.map((row) => ({
    id: row.id,
    bucket: row.bucket,
    hook: row.hook,
    on_screen_captions: row.on_screen_captions,
    caption_options: row.caption_options,
    author: row.author ? row.author.toLowerCase() : null,
    source_caption: row.raw_caption ? cleanCaption(row.raw_caption) : null,
    duration_sec: row.duration_sec,
    formats: row.formats,
    topic: row.topic,
    needs_others: needsOthers({
      author: row.author, rawCaption: row.raw_caption, speakerCount: row.speaker_count, formats: row.formats,
    }, couples),
    verdict: row.verdict,
    filmed: row.filmed,
    messages: row.messages,
  }))
  const shaped = shapeWeek(inputs, own, solo)
  const drop = shaped.map((one) => one.duplicate || one.hidden)
  // Captions only for the cards she will see — handing them to folded-away
  // repeats spent the library before the last cards of the week got any.
  const shown = inputs.filter((_, index) => !drop[index])
  const filled = fillCaptions(shown, usable, wrong)
  const captionsOf = new Map(shown.map((input, index) => [input.id, filled[index]]))
  return inputs.map((input, index) => ({
    ...cleanHook(input),
    caption_options: captionsOf.get(input.id) ?? input.caption_options,
    mine: shaped[index].mine,
    drop: drop[index],
  }))
}
