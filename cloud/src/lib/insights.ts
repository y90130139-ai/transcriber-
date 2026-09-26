/**
 * Her profile, worked out rather than typed.
 *
 * Measured 2026-09-20 across 24 active models: `formats` filled on 2, `hooks`
 * on 1, `wont_do` on 2. A profile a person has to type is a profile that stays
 * empty — and an empty one produced no plan at all, because matching needs a
 * tag to explain a pick. So each field the manual's setup steps ask for is
 * derived here from what her accounts already did, with the evidence beside
 * it, and offered for a tap.
 *
 *   Step 1  level          followers, her median plays, how steadily she posts
 *   Step 3  similar        watched creators who share her formats and persona
 *   Step 4  won't-do       formats she has declined as "not comfortable"
 *   Step 6  verticals      her own winners, grouped by format, tiered A/B/C
 *
 * The rule carried from the audit: derived values may drive *planning*
 * straight away, but anything that reaches *her* with our name on it waits for
 * a human to accept it.
 */
import { sql } from './db'
import { bankFor, type Bank } from './bank'
import { jobsForPosts } from './hers'
import { instagramAccounts, readSocials } from './socials'
import { labelOf } from './taxonomy'
import { FORMAT_GENERIC_SHARE } from './why'
import { nicheStrength, type NicheStrength } from './niches'

/* ----------------------------------------------------------------- level */

/** Thresholds for the manual's one decision: test first, or personalise now.
 *  Deliberately coarse — the manual itself only splits two ways, and a third
 *  band exists so a creator on the line is not forced into either. */
export const LEVEL = {
  newFollowersBelow: 10_000,
  newMedianBelow: 5_000,
  establishedFollowersAtLeast: 50_000,
  establishedMedianAtLeast: 20_000,
} as const

export type Level = 'new' | 'growing' | 'established'

export type LevelRead = {
  level: Level
  /** The manual's routing for that level, said plainly. */
  route: string
  followers: number | null
  median_plays: number | null
  reels_30d: number
  reasons: string[]
}

const ROUTE: Record<Level, string> = {
  new: 'Test first: a testing round of 6, feedback, then 15 — collect data before branding.',
  growing: 'Test lightly, then brand: run the three starter verticals and lean into what wins.',
  established: 'Personalise now: she expects strategy, so build from her own winners from week one.',
}

export async function levelFor(modelId: string, bank: Bank): Promise<LevelRead> {
  const handles = bank.accounts.map((account) => account.handle)
  const [row] = handles.length === 0 ? [null] : await sql.query(
    `select max(s.followers)::bigint as followers,
            (select count(*)::int from transcriber.creator_posts p
              where p.handle = any($1::text[]) and p.kind = 'reel'
                and p.posted_at >= now() - interval '30 days') as reels_30d
       from (select distinct on (handle) handle, followers
               from transcriber.creator_snapshots
              where handle = any($1::text[])
              order by handle, seen_at desc) s`,
    [handles],
  )
  const followers = row?.followers === null || row?.followers === undefined ? null : Number(row.followers)
  const medians = bank.accounts.map((account) => account.median_plays).filter((m): m is number => m !== null)
  const median = medians.length ? Math.max(...medians) : null
  const reels = Number(row?.reels_30d ?? 0)

  const reasons: string[] = []
  if (followers !== null) reasons.push(`${followers.toLocaleString('en-US')} followers on her biggest account`)
  if (median !== null) reasons.push(`${Math.round(median).toLocaleString('en-US')} median plays`)
  reasons.push(`${reels} reel${reels === 1 ? '' : 's'} in the last 30 days`)

  let level: Level = 'growing'
  if ((followers !== null && followers < LEVEL.newFollowersBelow) ||
      (median !== null && median < LEVEL.newMedianBelow) ||
      (followers === null && median === null)) {
    level = 'new'
  } else if ((followers ?? 0) >= LEVEL.establishedFollowersAtLeast ||
             (median ?? 0) >= LEVEL.establishedMedianAtLeast) {
    level = 'established'
  }
  if (followers === null && median === null) reasons.push('nothing swept yet, so she reads as new until it is')

  // Small is not the same as untested. The round exists to collect data; an
  // account that already produced a 10x reel has, and the planner skips it.
  const route = level === 'new' && bank.winners.length > 0
    ? `Small, but already proven: ${bank.winners.length} reel${bank.winners.length === 1 ? '' : 's'} past 10x her median, so skip the testing round and build from those.`
    : ROUTE[level]
  return { level, route, followers, median_plays: median, reels_30d: reels, reasons }
}

/* ------------------------------------------------------------- verticals */

/** The manual's three: every creator starts on Talking (Car Confessions),
 *  Thirst Traps and Captions. Captions means reels carried by on-screen text. */
export const STARTER_VERTICALS = ['car-confession', 'thirst-trap', 'text-overlay'] as const

export type Vertical = {
  format: string
  /** "Girl next door · Car confession" — a proposal, renamed on accept. */
  name: string
  tier: 'A' | 'B' | 'C' | null
  /** How many of her winners and iterations are this format. */
  posts: number
  best_multiple: number | null
  source: 'her-winners' | 'starter'
}

const MAX_VERTICALS = 5

export async function verticalsFor(
  modelId: string,
  bank: Bank,
  persona: string[],
): Promise<Vertical[]> {
  const graded = [...bank.winners, ...bank.iterations]
  const jobs = await jobsForPosts(graded.map((post) => post.post_id))
  const byJob = new Map<string, number>()
  for (const post of graded) {
    const job = jobs.get(post.post_id)
    if (job) byJob.set(job, Math.max(byJob.get(job) ?? 0, post.multiple))
  }

  const rows = byJob.size === 0 ? [] : await sql.query(
    `select job_id, tag from transcriber.tags
      where axis = 'format' and job_id = any($1::text[])`,
    [[...byJob.keys()]],
  )

  const tally = new Map<string, { posts: number; best: number }>()
  for (const row of rows) {
    const multiple = byJob.get(String(row.job_id)) ?? 0
    const seen = tally.get(String(row.tag)) ?? { posts: 0, best: 0 }
    tally.set(String(row.tag), { posts: seen.posts + 1, best: Math.max(seen.best, multiple) })
  }

  const personaWord = persona[0] ? labelOf('persona', persona[0]) : null
  const nameOf = (format: string) =>
    personaWord ? `${personaWord} · ${labelOf('format', format)}` : labelOf('format', format)

  const hers: Vertical[] = [...tally.entries()]
    .sort((a, b) => b[1].posts - a[1].posts || b[1].best - a[1].best)
    .slice(0, MAX_VERTICALS)
    .map(([format, stats]) => ({
      format,
      name: nameOf(format),
      tier: null,
      posts: stats.posts,
      best_multiple: Math.round(stats.best * 10) / 10,
      source: 'her-winners' as const,
    }))

  // Fewer than three of her own and the manual's starters fill the rest —
  // that is its own instruction for a creator without data yet.
  for (const format of STARTER_VERTICALS) {
    if (hers.length >= 3) break
    if (hers.some((vertical) => vertical.format === format)) continue
    hers.push({ format, name: nameOf(format), tier: null, posts: 0, best_multiple: null, source: 'starter' })
  }

  return hers.map((vertical, index) => ({
    ...vertical,
    tier: index === 0 ? 'A' : index === 1 ? 'B' : index === 2 ? 'C' : null,
  }))
}

/* -------------------------------------------------------- similar creators */

export type Similar = {
  handle: string
  score: number
  shared_formats: string[]
  shared_persona: string[]
  /** How many of their reels made the library — winners, by construction. */
  winners: number
}

/**
 * The manual's "narrow to 3": creators who share her formats and persona and
 * who post winners consistently. Persona is only on 18 of 195 watched
 * creators, so formats carry most of the weight; persona counts where it is
 * known. Her own accounts are excluded — a model is not her own competitor.
 */
export async function similarFor(
  handles: string[],
  formats: string[],
  persona: string[],
): Promise<Similar[]> {
  if (formats.length === 0 && persona.length === 0) return []
  const rows = await sql.query(
    `with ours as (
       -- Every account any model runs. A model is never another model's
       -- benchmark: that would compare the roster against itself.
       select lower(m.handle) as handle from transcriber.models m where m.handle is not null
       union
       select lower(s->>'handle') from transcriber.models m,
              jsonb_array_elements(coalesce(m.socials, '[]'::jsonb)) s
        where s->>'platform' = 'instagram'
     ),
     generic as (
       -- House styles on over a third of the library say nothing about
       -- likeness — the same rule why.ts uses to keep them out of reasons.
       select tag from transcriber.tags where axis = 'format'
        group by tag having count(*) > $4::float * (select count(*) from transcriber.transcripts)
     ),
     per as (
       select t.author as handle,
              array_agg(distinct g.tag) filter (where g.axis = 'format')  as formats,
              array_agg(distinct g.tag) filter (where g.axis = 'persona') as persona,
              count(distinct t.job_id)::int as winners
         from transcriber.transcripts t
         join transcriber.tags g on g.job_id = t.job_id
         join transcriber.creators c on c.handle = t.author and c.watch = 'watching'
        where t.author <> all($1::text[])
          and t.author not in (select handle from ours)
          and not (g.axis = 'format' and g.tag in (select tag from generic))
        group by t.author
     )
     select p.handle, p.winners,
            array(select unnest(coalesce(p.formats, '{}')) intersect select unnest($2::text[])) as shared_formats,
            array(select unnest(coalesce(p.persona, '{}') || coalesce(c.persona, '{}'))
                  intersect select unnest($3::text[])) as shared_persona
       from per p
       join transcriber.creators c on c.handle = p.handle`,
    [handles, formats, persona, FORMAT_GENERIC_SHARE],
  )
  return rows
    .map((row) => {
      const sharedFormats = (row.shared_formats as string[]) ?? []
      const sharedPersona = (row.shared_persona as string[]) ?? []
      const winners = Number(row.winners ?? 0)
      // Persona is the stronger claim when it exists; winners break ties and
      // reward a creator who keeps producing, which is the manual's fourth test.
      const score = 3 * sharedPersona.length + 2 * sharedFormats.length + Math.min(winners, 10) / 5
      return { handle: String(row.handle), score: Math.round(score * 10) / 10, shared_formats: sharedFormats, shared_persona: sharedPersona, winners }
    })
    .filter((row) => row.shared_formats.length + row.shared_persona.length > 0)
    .sort((a, b) => b.score - a.score || b.winners - a.winners)
    .slice(0, 3)
}

/* --------------------------------------------------------------- won't do */

export type WontDo = { format: string; label: string; declines: number }

/** Two "not comfortable" declines on one format is her telling us what feels
 *  fake — the Step 2 question nobody ever writes down. Already on her list is
 *  not proposed again. */
export const WONT_DO_AFTER = 2

export async function wontDoProposals(modelId: string, current: string[]): Promise<WontDo[]> {
  const rows = await sql.query(
    `select g.tag, count(*)::int as declines
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.tags g on g.job_id = i.job_id and g.axis = 'format'
      where p.model_id = $1 and i.decline_code = 'not-comfortable'
      group by g.tag
     having count(*) >= $2`,
    [modelId, WONT_DO_AFTER],
  )
  return rows
    .filter((row) => !current.includes(String(row.tag)))
    .map((row) => ({ format: String(row.tag), label: labelOf('format', String(row.tag)), declines: Number(row.declines) }))
}

/* ---------------------------------------------------------------- all four */

export type Insights = {
  model_id: string
  level: LevelRead
  verticals: Vertical[]
  similar: Similar[]
  wont_do: WontDo[]
  /** What the planner matches her on right now, and why. */
  matching: { formats: string[]; basis: 'her-profile' | 'derived' | 'starter' }
  /** Whether her niches carry winners in what we watch (`niches.ts`). */
  niches: NicheStrength
}

export async function insightsFor(modelId: string): Promise<Insights | null> {
  const [model] = await sql.query(
    `select id, handle, socials, persona, formats, wont_do, topics from transcriber.models where id = $1`,
    [modelId],
  )
  if (!model) return null
  const bank = await bankFor(modelId)
  if (!bank) return null

  const persona = (model.persona as string[]) ?? []
  const typed = (model.formats as string[]) ?? []
  const handles = instagramAccounts(model.handle as string | null, readSocials(model.socials))

  // Her niches as matching reads them: typed ones win, else read off her reels.
  const typedTopics = (model.topics as string[] | null) ?? []
  const [level, verticals, wontDo, topics] = await Promise.all([
    levelFor(modelId, bank),
    verticalsFor(modelId, bank, persona),
    wontDoProposals(modelId, (model.wont_do as string[]) ?? []),
    typedTopics.length ? Promise.resolve(typedTopics) : topicsFor(modelId),
  ])

  const matching = effectiveFormats(typed, verticals)
  const [similar, niches] = await Promise.all([
    similarFor(handles, matching.formats, persona),
    nicheStrength(topics, handles),
  ])

  return { model_id: modelId, level, verticals, similar, wont_do: wontDo, matching, niches }
}

/** What to match her on: her typed formats if anyone typed them, else her
 *  derived verticals, else the manual's starters. Never empty — an empty set is
 *  what left 9 models without a plan. */
export function effectiveFormats(
  typed: string[],
  verticals: Vertical[],
): Insights['matching'] {
  if (typed.length > 0) return { formats: typed, basis: 'her-profile' }
  const derived = verticals.filter((vertical) => vertical.source === 'her-winners').map((vertical) => vertical.format)
  if (derived.length > 0) {
    return { formats: [...new Set([...derived, ...STARTER_VERTICALS])], basis: 'derived' }
  }
  return { formats: [...STARTER_VERTICALS], basis: 'starter' }
}

/**
 * Her niches, read off her own reels rather than typed.
 *
 * The same shape as `verticalsFor`, one axis over: what her posts are *about*.
 * Kaytie's account is golf and the library holds 51 golf reels; before the
 * topic axis existed (2026-09-22) nothing connected the two and she was handed
 * generic tests. Derived from everything of hers that reached the library, not
 * only her winners — a niche is what she posts, not only what took off.
 *
 * `relatable` and `unknown` are never returned: neither is a subject, and a
 * model whose "niche" was relatable would match the entire library.
 */
export async function topicsFor(modelId: string): Promise<string[]> {
  const rows = await sql.query(
    `select g.tag, count(*)::int as posts
       from transcriber.jobs j
       join transcriber.tags g on g.job_id = j.id
      where j.batch_id = $1 and g.axis = 'topic'
        and g.tag not in ('relatable', 'unknown')
      group by g.tag
      having count(*) >= ${MIN_TOPIC_POSTS}
      order by count(*) desc
      limit ${MAX_TOPICS}`,
    [`hers-${modelId}`],
  )
  return rows.map((row) => String(row.tag))
}

/** One reel about golf is a day out; two is a niche. */
const MIN_TOPIC_POSTS = 2

/** More than this and it is not a niche any more. */
const MAX_TOPICS = 3
