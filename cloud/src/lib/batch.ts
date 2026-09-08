/**
 * The Monday fix: draft every active model's next week in one pass.
 *
 * Week creation was per model, per click. At twenty models that is twenty
 * clicks and eighty hand-authored cards every Monday, which is the point where
 * the roster stops scaling for reasons that have nothing to do with the work.
 *
 * Three rules run through all of it:
 *
 *   1. Nothing auto-sends. Ever. Every week this opens lands as a draft, which
 *      is invisible to her until somebody marks it sent.
 *   2. It only ever proposes. The preview is computed, looked at, and then
 *      written — the same draft-then-approve shape the persona backfill uses,
 *      for the same reason.
 *   3. The collision warning from item 6 is applied across the whole batch,
 *      which is the entire reason that item came first. A batch builder without
 *      it hands the same reel to every creator in one click.
 */
import { currentWeekOf } from './dates'
import { sql } from './db'
import { suggestionsFor } from './match'

/** How deep into a model's ranked suggestions to look for something nobody
 *  else in this batch has taken. Three times what she needs is enough of a
 *  bench to stagger a roster without reaching for reels that barely fit. */
const BENCH = 3

/** `match.ts` will not return more than this in one call. */
const SUGGESTION_CAP = 40

/** Another model already carrying this reel — outside this batch. */
export type BatchCollision = { model_id: string; name: string; week_of: string }

export type BatchPick = {
  job_id: string
  author: string | null
  fit: number
  matched: string[]
  /** Weeks elsewhere that already hold it. Warned, never blocked. */
  also_on: BatchCollision[]
  /** Another model in *this* batch who was given it first. Null unless there
   *  was nothing else left that fitted her. */
  claimed_by: string | null
}

export type BatchRow = {
  model_id: string
  name: string
  tier: 'A' | 'B' | 'C'
  weekly_target: number
  /** Already on that week — a batch tops a week up, it never replaces it. */
  already: number
  wanted: number
  picks: BatchPick[]
  /** How many she is still short after the library ran out of things that fit.
   *  Usually an unfilled profile rather than a dry library. */
  short: number
}

export type Batch = { weekOf: string; rows: BatchRow[] }

/**
 * What one pass would draft, without writing anything.
 *
 * Models are taken in tier order, so when two of them want the same reel the
 * bespoke tier gets first refusal and the rest are staggered onto their next
 * best fit. That stagger is the thing the scaling plan always assumed existed
 * and nothing in the console has ever actually done.
 */
export async function previewBatch(weekOf?: string): Promise<Batch> {
  const week = weekOf ?? currentWeekOf()

  const models = await sql.query(
    `select m.id, m.name, m.tier, m.weekly_target,
            coalesce(w.items, 0)::int as already
       from transcriber.models m
       left join lateral (
         select count(i.id) as items
           from transcriber.plans p
           left join transcriber.plan_items i on i.plan_id = p.id
          where p.model_id = m.id and p.week_of = $1::date
       ) w on true
      where m.status = 'active'
      order by m.tier, m.name`,
    [week],
  )

  // Every reel handed out in this pass, and to whom. This is the only thing
  // that makes the batch a stagger rather than twenty copies of one week.
  const claimed = new Map<string, string>()
  const rows: BatchRow[] = []

  for (const model of models) {
    const target = Number(model.weekly_target ?? 0)
    const already = Number(model.already ?? 0)
    const wanted = Math.max(target - already, 0)

    if (wanted === 0) {
      rows.push({
        model_id: String(model.id),
        name: String(model.name),
        tier: (model.tier as 'A' | 'B' | 'C') ?? 'B',
        weekly_target: target,
        already,
        wanted,
        picks: [],
        short: 0,
      })
      continue
    }

    // `suggestionsFor` already excludes what is on a plan of hers, everything
    // she has said she will not do, and anything it cannot explain.
    const ranked = await suggestionsFor(
      String(model.id),
      Math.min(wanted * BENCH, SUGGESTION_CAP),
    )

    const picks: BatchPick[] = []
    const contested: BatchPick[] = []

    for (const row of ranked) {
      if (picks.length >= wanted) break
      const pick: BatchPick = {
        job_id: String(row.id),
        author: (row.author as string | null) ?? null,
        fit: Number(row.fit ?? 0),
        matched: Array.isArray(row.matched) ? (row.matched as string[]) : [],
        also_on: Array.isArray(row.also_on) ? (row.also_on as BatchCollision[]) : [],
        claimed_by: claimed.get(String(row.id)) ?? null,
      }
      // Held back rather than dropped: if the bench runs out she still gets a
      // full week, and the duplicate arrives flagged instead of silent.
      if (pick.claimed_by) { contested.push(pick); continue }
      picks.push(pick)
      claimed.set(pick.job_id, String(model.name))
    }

    for (const pick of contested) {
      if (picks.length >= wanted) break
      picks.push(pick)
    }

    rows.push({
      model_id: String(model.id),
      name: String(model.name),
      tier: (model.tier as 'A' | 'B' | 'C') ?? 'B',
      weekly_target: target,
      already,
      wanted,
      picks,
      short: Math.max(wanted - picks.length, 0),
    })
  }

  return { weekOf: week, rows }
}
