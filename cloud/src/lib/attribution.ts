/**
 * Which variable actually moved her numbers — the ladder's payoff.
 *
 * A Double Down batch is two controls and three variants of one axis. Until
 * something compares them it is five posts, not an experiment. This compares
 * them: for every batch whose cards have been bound to the reels she posted,
 * the variants' plays against the controls' plays, per axis. Three batches in,
 * her account has answered whether outfits, backgrounds or openings are what
 * her audience responds to — which the manual calls finding her brand.
 *
 * Only **bound** cards count. A card is bound when someone taps which of her
 * reels delivered it (`plan_items.post_url`). Guessing the binding from dates
 * would be guessing the answer; the count of unbound cards is reported instead,
 * so a thin result says why it is thin.
 */
import { sql } from './db'

/** Below this many measured posts on each side, a ratio is anecdote. */
const MIN_EACH_SIDE = 1

export type AxisResult = {
  axis: string
  batches: number
  /** Variants' median plays over controls' median plays. >1 means the change helped. */
  lift: number | null
  controls: number
  variants: number
  verdict: string
}

export type Attribution = {
  axes: AxisResult[]
  /** Ladder cards not yet bound to a posted reel — why a result is missing. */
  unbound: number
}

const shortcode = (url: string | null): string | null =>
  url?.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]{5,})/)?.[1] ?? null

export async function attributionFor(modelId: string): Promise<Attribution> {
  const rows = await sql.query(
    `select i.source_post, i.axis, i.post_url
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1 and i.bucket = 'reskin' and i.source_post is not null`,
    [modelId],
  )

  const codes = rows.map((row) => shortcode(row.post_url as string | null)).filter((c): c is string => Boolean(c))
  const plays = new Map<string, number>()
  if (codes.length > 0) {
    const measured = await sql.query(
      `select post_id, plays from transcriber.creator_posts where post_id = any($1::text[]) and plays is not null`,
      [codes],
    )
    for (const row of measured) plays.set(String(row.post_id), Number(row.plays))
  }

  // Group each batch's measured controls and variants, by the batch's axis.
  const batches = new Map<string, { axis: string | null; controls: number[]; variants: number[] }>()
  let unbound = 0
  for (const row of rows) {
    const key = String(row.source_post)
    const batch = batches.get(key) ?? { axis: null, controls: [], variants: [] }
    if (row.axis) batch.axis = String(row.axis)
    const code = shortcode(row.post_url as string | null)
    const value = code ? plays.get(code) : undefined
    if (value === undefined) unbound += 1
    else (row.axis ? batch.variants : batch.controls).push(value)
    batches.set(key, batch)
  }

  const byAxis = new Map<string, { batches: number; controls: number[]; variants: number[] }>()
  for (const batch of batches.values()) {
    if (!batch.axis) continue
    if (batch.controls.length < MIN_EACH_SIDE || batch.variants.length < MIN_EACH_SIDE) continue
    const seen = byAxis.get(batch.axis) ?? { batches: 0, controls: [], variants: [] }
    // Normalised per batch, so one huge winner does not drown two small ones.
    const base = median(batch.controls)
    if (!base) continue
    seen.batches += 1
    seen.controls.push(1)
    seen.variants.push(median(batch.variants) / base)
    byAxis.set(batch.axis, seen)
  }

  const axes: AxisResult[] = [...byAxis.entries()].map(([axis, stats]) => {
    const lift = Math.round(median(stats.variants) * 100) / 100
    return {
      axis,
      batches: stats.batches,
      lift,
      controls: stats.controls.length,
      variants: stats.variants.length,
      verdict:
        lift >= 1.2 ? `Changing the ${axis} helps her — variants ran ${lift}× the controls.`
        : lift <= 0.8 ? `Changing the ${axis} costs her — keep it as the winner had it.`
        : `The ${axis} barely matters for her. Change it freely.`,
    }
  })

  return { axes, unbound }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
