/** Which videos suit which model, and the other way round.
 *
 * A model carries the same three axes the library tags videos with, so the two
 * sides can find each other. Built the way `hot.ts` and `brief.ts` were built:
 * deterministic, rule-based, no API key, every constant in this file — a bad
 * recommendation is then a number you can read and change.
 */
import { sql } from './db'
import { SCORING_CTE } from './hot'
import { preview } from './sql'

/** Format weighs most: it is the thing she physically has to be able to shoot.
 *  Persona is next — it is a claim about a person and is stable. Hook is a
 *  tiebreaker, because almost any hook can be re-shot in any format. */
const FORMAT_WEIGHT = 3
const PERSONA_WEIGHT = 2
const HOOK_WEIGHT = 1

/** A proven video is worth surfacing, but fit has to win. The cap stops one
 *  viral outlier outranking a video she can actually make. */
const OUTPERFORMANCE_CAP = 3

/** Below this, say nothing. One format match, or a persona match plus a hook. */
export const MIN_FIT = 3

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 40

/** How many of `theirs` appear in `hers`. A scalar subquery rather than an
 *  array intersect, because it reads the same in every dialect of my future self. */
const overlap = (theirs: string, hers: string) =>
  `(select count(*)::int from unnest(coalesce(${theirs}, '{}'::text[])) o where o = any(${hers}))`

/** The tags that actually caused the score — a recommendation you cannot
 *  explain is one that stops being trusted. */
const matched = (theirs: string, hers: string) =>
  `array(select unnest(coalesce(${theirs}, '{}'::text[])) intersect select unnest(${hers}))`

/** One row per job, with its tags collected into three arrays. */
const ITEM_TAGS = `
  item_tags as (
    select job_id,
           array_agg(tag) filter (where axis = 'persona') as persona,
           array_agg(tag) filter (where axis = 'format')  as format,
           array_agg(tag) filter (where axis = 'hook')    as hook
      from transcriber.tags
     group by job_id
  )
`

const FIT = `
  ${FORMAT_WEIGHT} * ${overlap('g.format', 'm.formats')}
  + ${PERSONA_WEIGHT} * ${overlap('g.persona', 'm.persona')}
  + ${HOOK_WEIGHT} * ${overlap('g.hook', 'm.hooks')}
  + least(coalesce(s.score / nullif(b.median_score, 0), 0), ${OUTPERFORMANCE_CAP})
`

const MATCHED = `${matched('g.format', 'm.formats')} || ${matched('g.persona', 'm.persona')}`

/** She has said no to this video's format. A hard exclusion, applied before scoring. */
const NOT_REFUSED = `not (coalesce(g.format, '{}'::text[]) && m.wont_do)`

/** She already has it. Recommending what is on her plan is noise. */
const NOT_ASSIGNED = `
  not exists (
    select 1 from transcriber.plan_items i
      join transcriber.plans p on p.id = i.plan_id
     where i.job_id = j.id and p.model_id = m.id
  )
`

/**
 * Which of our models suit one library item.
 *
 * Only active models, and only ones that actually score — an untagged model
 * matches nothing rather than matching everything, because reading her as
 * omnivorous is worse than reading her as unconfigured.
 */
export async function modelsForJob(jobId: string) {
  return sql.query(
    `with ${SCORING_CTE}, ${ITEM_TAGS}
     select ranked.id, ranked.name, ranked.fit, ranked.matched
       from (
         select m.id, m.name, (${FIT})::float as fit, ${MATCHED} as matched
           from transcriber.models m
           join transcriber.jobs j on j.id = $1
           join item_tags g on g.job_id = j.id
           left join transcriber.transcripts t on t.job_id = j.id
           left join scored   s on s.job_id = t.job_id
           left join baseline b on b.author = t.author
          where m.status = 'active' and ${NOT_REFUSED} and ${NOT_ASSIGNED}
       ) ranked
      where ranked.fit >= ${MIN_FIT}
      order by ranked.fit desc, ranked.name`,
    [jobId],
  )
}

/** Library items that fit one model and are not already on a plan of hers. */
export async function suggestionsFor(modelId: string, limit = DEFAULT_LIMIT) {
  const capped = Math.min(Math.max(Math.round(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  return sql.query(
    `with ${SCORING_CTE}, ${ITEM_TAGS}
     select ranked.* from (
       select j.id, t.author, t.duration_sec, t.upload_date,
              (t.thumbnail is not null) as has_thumb,
              ${preview('t.plain', 150)} as preview,
              round((s.score / nullif(b.median_score, 0))::numeric, 2)::float as outperformance,
              (${FIT})::float as fit,
              ${MATCHED} as matched
         from transcriber.models m
         join transcriber.jobs j on j.status = 'done'
         join item_tags g on g.job_id = j.id
         join transcriber.transcripts t on t.job_id = j.id
         left join scored   s on s.job_id = t.job_id
         left join baseline b on b.author = t.author
        where m.id = $1 and ${NOT_REFUSED} and ${NOT_ASSIGNED}
     ) ranked
      where ranked.fit >= ${MIN_FIT}
      order by ranked.fit desc, ranked.outperformance desc nulls last, ranked.upload_date desc
      limit ${capped}`,
    [modelId],
  )
}
