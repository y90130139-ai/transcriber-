/**
 * Her monthly Blueprint — the manual's per-model page, assembled rather than
 * written.
 *
 * The manual's structure, section by section: similar creators, brand pillars
 * (each with ideas, reference reels, a volume target and notes), what is
 * working, what to double down on, what to cut, the exact volume split, and
 * clear execution steps — plus the shoot-day routine that makes the volume
 * achievable. Every section is computed from something that already exists:
 * `insights.ts` (pillars, creators), `bank.ts` (what is working), `review.ts`
 * grades (what to cut), `split.ts` (the split), `attribution.ts` (what the
 * ladders taught). Nothing here is typed and nothing is invented.
 */
import { sql } from './db'
import { bankFor } from './bank'
import { insightsFor } from './insights'
import { attributionFor } from './attribution'
import { countsFor } from './split'
import { labelOf } from './taxonomy'

/** How a pillar's share of the week follows its tier. A leads, as the manual's
 *  A vertical is "the main traffic source". */
const TIER_SHARE: Record<string, number> = { A: 0.5, B: 0.3, C: 0.2 }

/** Ideas offered per pillar. The manual's example page lists 5–10. */
const IDEAS_PER_PILLAR = 6

export type Pillar = {
  format: string
  name: string
  tier: 'A' | 'B' | 'C' | null
  /** Reels a week from this pillar. */
  volume: number
  /** Library references to recreate, best first. */
  ideas: { job_id: string; author: string | null; url: string | null; preview: string | null }[]
  starter: boolean
}

export type Blueprint = {
  model_id: string
  name: string
  similar: string[]
  pillars: Pillar[]
  working: { post_id: string; url: string; multiple: number }[]
  learned: string[]
  cut: string[]
  split: { reskin: number; iteration: number; test: number; total: number }
  steps: string[]
  shoot_day: string[]
}

export async function blueprintFor(modelId: string): Promise<Blueprint | null> {
  const [model] = await sql.query(
    `select id, name, weekly_target, verticals, similar_creators, wont_do from transcriber.models where id = $1`,
    [modelId],
  )
  if (!model) return null
  const [insights, bank, attribution] = await Promise.all([
    insightsFor(modelId), bankFor(modelId), attributionFor(modelId),
  ])
  if (!insights || !bank) return null

  // Accepted wins over proposed, in both places a human can accept.
  const accepted = Array.isArray(model.verticals) && model.verticals.length > 0
    ? (model.verticals as { format: string; name: string; tier: 'A' | 'B' | 'C' | null }[])
    : null
  const verticals = (accepted ?? insights.verticals).slice(0, 3)
  const similar = (model.similar_creators as string[] | null)?.length
    ? (model.similar_creators as string[])
    : insights.similar.map((creator) => creator.handle)

  const target = Number(model.weekly_target) || 21
  const split = countsFor(target)

  const pillars: Pillar[] = []
  for (const vertical of verticals) {
    const ideas = await sql.query(
      `select t.job_id, t.author, t.webpage_url as url,
              left(coalesce(nullif(t.on_screen_text, ''), t.plain, ''), 120) as preview
         from transcriber.tags g
         join transcriber.transcripts t on t.job_id = g.job_id
         join transcriber.jobs j on j.id = t.job_id and j.status = 'done'
        where g.axis = 'format' and g.tag = $1
          and not (coalesce($3::text[], '{}') && array[g.tag])
          and not exists (
            select 1 from transcriber.plan_items i join transcriber.plans p on p.id = i.plan_id
             where i.job_id = t.job_id and p.model_id = $2)
        order by t.upload_date desc nulls last
        limit $4`,
      [vertical.format, modelId, model.wont_do ?? [], IDEAS_PER_PILLAR],
    )
    pillars.push({
      format: vertical.format,
      name: vertical.name,
      tier: vertical.tier,
      volume: Math.max(1, Math.round(target * (TIER_SHARE[vertical.tier ?? 'C'] ?? 0.2))),
      ideas: ideas.map((row) => ({
        job_id: String(row.job_id),
        author: row.author ? String(row.author) : null,
        url: row.url ? String(row.url) : null,
        preview: row.preview ? String(row.preview) : null,
      })),
      starter: 'source' in vertical && vertical.source === 'starter',
    })
  }

  const working = bank.winners.slice(0, 5).map((post) => ({
    post_id: post.post_id, url: post.url, multiple: post.multiple,
  }))

  // What to cut: formats she has been sent and declined, and any pillar that is
  // still a starter after her winners had the chance to replace it.
  const cut: string[] = []
  for (const format of (model.wont_do as string[] | null) ?? []) {
    cut.push(`${labelOf('format', format)} — she said it is not her; never sent.`)
  }
  for (const pillar of pillars) {
    if (pillar.starter && bank.winners.length >= 3) {
      cut.push(`${pillar.name} — still a starter with no winners of hers behind it. Swap it for the next best vertical after this month.`)
    }
  }

  return {
    model_id: modelId,
    name: String(model.name),
    similar,
    pillars,
    working,
    learned: attribution.axes.map((axis) => axis.verdict),
    cut,
    split: { ...split, total: target },
    steps: [
      'Saturday: review last week, pick the winners, build the week.',
      'Sunday: the call — what worked, what repeats, confirm the shoot day.',
      'Shoot day: film the whole week in one sitting, outfit by outfit.',
      'Post three a day at 10:00, 13:00 and 18:00 — never two inside an hour.',
      'Carousels from the shoot-day photos in the gaps, two a week.',
      'A story every day, following the week\'s themes.',
    ],
    shoot_day: [
      `Four outfits. In each, film ${pillars.length * 2} reels — two from each pillar.`,
      'Between outfit changes, take photo sets in three styles: mirror selfie, normal selfie, tripod. They become the carousels and the wall posts.',
      `${pillars.length * 2 * 4} reels in one day covers a ${target}-reel week with room to spare.`,
    ],
  }
}
