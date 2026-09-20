/**
 * The 70/20/10 split, measured before it is enforced.
 *
 * The rule: most of a week should be things already known to work, a fifth
 * should be a known thing with one variable changed, and a tenth should be a
 * real bet that is allowed to fail. A library that only ships proven formats
 * stops finding new ones; one that only experiments burns the roster.
 *
 * **This measures. It does not yet pick.** Changing how winners are chosen and
 * what they are measured against in the same step is the mistake this project
 * has a standing rule against, so the first version reports the mix a week
 * already has and how far it sits from target. Enforcing it in `batch.ts` is
 * the next step, once these numbers have been looked at against real weeks.
 *
 * How an item is classified, for one model:
 *
 *   proven        its format is one she is already known for (`models.formats`)
 *   adjacent      a new format, but through a hook she already uses
 *                 (`models.hooks`) — the same voice, a different shape
 *   experimental  neither: a format and an angle she has not run
 *
 * That leans on the curated `formats` and `hooks` on each model, which are
 * human-set and therefore trustworthy. Once the roster pass has collected
 * enough of a model's own posts, "proven" can be tightened to mean formats her
 * own posts beat her median with — evidence rather than intent. The shape of
 * this file does not change when it is.
 */
import { sql } from './db'

/** Geno's split. Shares of a week, not counts. */
export const TARGET_MIX = { proven: 0.7, adjacent: 0.2, experimental: 0.1 } as const

export type Band = 'proven' | 'adjacent' | 'experimental'

export type Mix = {
  plan_id: string
  model_id: string
  items: number
  counts: Record<Band, number>
  shares: Record<Band, number>
  target: typeof TARGET_MIX
  /** Signed distance from target, per band. Positive means over-weighted. */
  drift: Record<Band, number>
  /** The band the next pick should come from to move toward target. */
  wants: Band | null
}

const BANDS: Band[] = ['proven', 'adjacent', 'experimental']

export function classify(
  itemFormats: string[],
  itemHooks: string[],
  modelFormats: string[],
  modelHooks: string[],
): Band {
  const known = new Set(modelFormats)
  if (itemFormats.some((f) => known.has(f))) return 'proven'
  const voice = new Set(modelHooks)
  if (itemHooks.some((h) => voice.has(h))) return 'adjacent'
  return 'experimental'
}

/** What one drafted week actually consists of, against the rule. */
export async function mixOf(planId: string): Promise<Mix | null> {
  const [plan] = await sql.query(
    `select p.id, p.model_id, coalesce(m.formats, '{}') as formats,
            coalesce(m.hooks, '{}') as hooks
       from transcriber.plans p
       join transcriber.models m on m.id = p.model_id
      where p.id = $1`,
    [planId],
  )
  if (!plan) return null

  // Each item's tags, by axis, in one pass rather than per item.
  const rows = await sql.query(
    `select i.job_id,
            array_remove(array_agg(t.tag) filter (where t.axis = 'format'), null) as formats,
            array_remove(array_agg(t.tag) filter (where t.axis = 'hook'), null) as hooks
       from transcriber.plan_items i
       left join transcriber.tags t on t.job_id = i.job_id
      where i.plan_id = $1
      group by i.job_id`,
    [planId],
  )

  const counts: Record<Band, number> = { proven: 0, adjacent: 0, experimental: 0 }
  for (const row of rows) {
    const band = classify(
      (row.formats as string[] | null) ?? [],
      (row.hooks as string[] | null) ?? [],
      (plan.formats as string[] | null) ?? [],
      (plan.hooks as string[] | null) ?? [],
    )
    counts[band] += 1
  }

  const items = rows.length
  const shares = {} as Record<Band, number>
  const drift = {} as Record<Band, number>
  for (const band of BANDS) {
    shares[band] = items ? round(counts[band] / items, 3) : 0
    drift[band] = items ? round(shares[band] - TARGET_MIX[band], 3) : 0
  }

  // The most under-weighted band is what the week is short of. With no items
  // at all there is nothing to be short of yet.
  const wants = items
    ? BANDS.reduce((low, band) => (drift[band] < drift[low] ? band : low), BANDS[0])
    : null

  return {
    plan_id: String(plan.id),
    model_id: String(plan.model_id),
    items,
    counts,
    shares,
    target: TARGET_MIX,
    drift,
    wants,
  }
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
