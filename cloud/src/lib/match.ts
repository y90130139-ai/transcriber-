/** Which videos suit which model, and the other way round.
 *
 * A model carries the same three axes the library tags videos with, so the two
 * sides can find each other. Built the way `hot.ts` and `brief.ts` were built:
 * deterministic, rule-based, no API key, every constant in this file — a bad
 * recommendation is then a number you can read and change.
 */
import { sql } from './db'
import { SCORING_CTE } from './hot'
import { DECLINE_COOLDOWN_DAYS, PERMANENT_DECLINES } from './decline'
import { preview } from './sql'
import { jobsNeedingOthers } from './solo'

/** Format weighs most: it is the thing she physically has to be able to shoot.
 *  Topic is level with it — a golf reel handed to the golf model is the whole
 *  point of the axis, and before it existed 51 golf reels sat in the library
 *  while the golf model got generic tests. Persona is next; hook is a
 *  tiebreaker, because almost any hook can be re-shot in any format. */
const FORMAT_WEIGHT = 3
const TOPIC_WEIGHT = 3
const PERSONA_WEIGHT = 2
const HOOK_WEIGHT = 1

/** A reel about nothing in particular. It belongs to no model and suits any of
 *  them, so it scores on its own rather than on overlap — below a topic match,
 *  above nothing. What keeps it from filling a week is the cap in `split.ts`,
 *  not this number. */
const RELATABLE_WEIGHT = 1.5

/** A proven video is worth surfacing, but fit has to win. The cap stops one
 *  viral outlier outranking a video she can actually make. */
const OUTPERFORMANCE_CAP = 3

/**
 * Her thumbs (👍/👎 on her cards, `plan_items.rating`). Each vote counts for
 * every tag the rated reel shares with a candidate, and more for the same
 * account. Capped at one format match either way: her taste steers the list,
 * fit still decides it — one 👎 on a text overlay must not bury every text
 * overlay she can film. Tags every reel carries (`unknown`, `relatable`) say
 * nothing about taste and are left out.
 */
const TAG_VOTE = 0.5
const ACCOUNT_VOTE = 1
const TASTE_CAP = FORMAT_WEIGHT

const TASTE = `
  greatest(-${TASTE_CAP}, least(${TASTE_CAP},
    ${TAG_VOTE} * coalesce((
      select sum(vi.rating)
        from transcriber.plan_items vi
        join transcriber.plans vp on vp.id = vi.plan_id
        join transcriber.tags voted on voted.job_id = vi.job_id
        join transcriber.tags here on here.job_id = j.id and here.axis = voted.axis and here.tag = voted.tag
       where vp.model_id = m.id and vi.rating is not null and vi.job_id <> j.id
         and voted.axis in ('format', 'topic', 'hook', 'persona')
         and voted.tag not in ('unknown', 'relatable')
    ), 0)
    + ${ACCOUNT_VOTE} * coalesce((
      select sum(vi.rating)
        from transcriber.plan_items vi
        join transcriber.plans vp on vp.id = vi.plan_id
        join transcriber.transcripts vt on vt.job_id = vi.job_id
       where vp.model_id = m.id and vi.rating is not null and vi.job_id <> j.id
         and lower(vt.author) = lower(t.author)
    ), 0)
  ))
`

/** Below this, say nothing. One format match, or a persona match plus a hook. */
export const MIN_FIT = 3

const DEFAULT_LIMIT = 12
/** Fetched per slot asked for, so filtering out reels a solo model cannot
 *  film still leaves a full list. */
const SOLO_HEADROOM = 2
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
           array_agg(tag) filter (where axis = 'hook')    as hook,
           array_agg(tag) filter (where axis = 'topic')   as topic
      from transcriber.tags
     group by job_id
  )
`

/** Is this one of the reels any model can be handed with a twist? */
const IS_RELATABLE = `(case when 'relatable' = any(coalesce(g.topic, '{}'::text[])) then 1 else 0 end)`

const FIT = `
  ${FORMAT_WEIGHT} * ${overlap('g.format', 'm.formats')}
  + ${TOPIC_WEIGHT} * ${overlap('g.topic', 'm.topics')}
  + ${PERSONA_WEIGHT} * ${overlap('g.persona', 'm.persona')}
  + ${HOOK_WEIGHT} * ${overlap('g.hook', 'm.hooks')}
  + ${RELATABLE_WEIGHT} * ${IS_RELATABLE}
  + least(coalesce(s.score / nullif(b.median_score, 0), 0), ${OUTPERFORMANCE_CAP})
  + ${TASTE}
`

/** What the card says the match was. Topic joins format and persona: "golf" is
 *  the most convincing reason a reel is hers that this system can give. A
 *  relatable reel explains itself as `relatable`, which is what makes it
 *  offerable at all — `EXPLAINABLE` drops anything with an empty reason, and
 *  370 reels of the library have no topic and nothing else to say. */
const MATCHED = `${matched('g.format', 'm.formats')} || ${matched('g.topic', 'm.topics')} || ${matched('g.persona', 'm.persona')}`
  + ` || (case when ${IS_RELATABLE} = 1 then array['relatable'] else '{}'::text[] end)`

/**
 * A score with nothing behind it is not a recommendation.
 *
 * `MATCHED` collects format and persona only. An item carrying neither — just
 * a hook — can still reach 4 on hook weight plus outperformance and surface in
 * the rail with a confident number and a completely empty explanation. 36 of
 * 166 items in the library are in exactly that state.
 *
 * The guard is on the empty explanation, not on how short it is: an item with
 * one five-word format tag explains itself perfectly, and one with a long
 * untagged transcript explains nothing. Those are different sets.
 */
const EXPLAINABLE = `cardinality(ranked.matched) > 0`

/**
 * Who else is already carrying this reel.
 *
 * `NOT_ASSIGNED` below excludes what is already on a plan, but the exclusion is
 * scoped `p.model_id = m.id` — per model. With one model that is complete. With
 * ten, one strong reel is the top suggestion for all ten in the same week and
 * nothing in the console says so; the scaling plan assumes a stagger that does
 * not exist anywhere in the data.
 *
 * This warns. It deliberately does not filter: two creators on one trend is
 * sometimes exactly what is wanted, and that is Geno's call to make with the
 * fact in front of him rather than the query's to make silently.
 */
export const alsoOn = (job: string, model: string) => `
  coalesce((
    select json_agg(json_build_object(
             'model_id', other.model_id,
             'name',     om.name,
             'week_of',  to_char(other.week_of, 'YYYY-MM-DD'),
             'status',   other.status
           ) order by other.week_of desc)
      from transcriber.plan_items oi
      join transcriber.plans  other on other.id = oi.plan_id
      join transcriber.models om    on om.id = other.model_id
     where oi.job_id = ${job} and other.model_id <> ${model}
  ), '[]'::json)
`

/** She has said no to this video's format. A hard exclusion, applied before scoring. */
const NOT_REFUSED = `not (coalesce(g.format, '{}'::text[]) && m.wont_do)`

/**
 * A reel about a subject goes only to a model in that subject.
 *
 * Weight alone was not enough: with topic merely *adding* to the score, three
 * golf reels landed in Helwife's week and three more in Juno's on the first
 * run — neither has anything to do with golf, and neither has a course to
 * film on. A subject is a gate, not a bonus.
 *
 * `relatable` and `unknown` are not subjects, so they pass: the first is meant
 * for everyone, and the second means nobody could tell, which is not grounds
 * to refuse it.
 */
const TOPIC_ALLOWED = `
  not exists (
    select 1 from unnest(coalesce(g.topic, '{}'::text[])) as subject
     where subject not in ('relatable', 'unknown')
       and not (subject = any(coalesce(m.topics, '{}'::text[])))
  )
`
/**
 * She said no to this one.
 *
 * `NOT_ASSIGNED` below already skips anything sitting on a plan of hers, which
 * covered a declined card only for as long as the card existed — delete it and
 * the same reel came back the following week. This reads the decline itself,
 * so her "no" survives the card, the week and the plan.
 */
const NOT_DECLINED = `
  not exists (
    select 1 from transcriber.declines d
     where d.model_id = m.id and d.job_id = j.id
       and (
         -- "Not comfortable with it" is her saying the idea is not her, and
         -- that does not expire. Everything else is circumstance — no time,
         -- the wrong outfit, nowhere to film — so the reel is held back for a
         -- while and then allowed to come round again.
         d.code = any('{${PERMANENT_DECLINES.join(',')}}'::text[])
         or d.declined_at > now() - interval '${DECLINE_COOLDOWN_DAYS} days'
       )
  )
`

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
     select ranked.id, ranked.name, ranked.fit, ranked.matched,
            ranked.declined_code, ranked.declined_reason
       from (
         select m.id, m.name, (${FIT})::float as fit, ${MATCHED} as matched,
                d.code as declined_code, d.reason as declined_reason
           from transcriber.models m
           left join transcriber.declines d on d.model_id = m.id and d.job_id = $1
           join transcriber.jobs j on j.id = $1
           join item_tags g on g.job_id = j.id
           left join transcriber.transcripts t on t.job_id = j.id
           left join scored   s on s.job_id = t.job_id
           left join baseline b on b.author = t.author
          where m.status = 'active' and ${NOT_REFUSED} and ${NOT_ASSIGNED}
            and ${TOPIC_ALLOWED}
       ) ranked
      where ranked.fit >= ${MIN_FIT} and ${EXPLAINABLE}
      order by ranked.fit desc, ranked.name`,
    [jobId],
  )
}

/**
 * Library items that fit one model and are not already on a plan of hers.
 *
 * `formats`, when given, stands in for `models.formats`. That is how a model
 * whose profile nobody filled in still gets matched: the planner passes her
 * *derived* verticals, or the manual's three starting ones, instead of the
 * empty column that used to make `EXPLAINABLE` reject every item — which is
 * why 9 of 24 models had never been given a plan at all. A typed profile still
 * wins; the override is only ever passed when the column is empty.
 */
export async function suggestionsFor(
  modelId: string,
  limit = DEFAULT_LIMIT,
  formats?: string[],
  topics?: string[],
) {
  const capped = Math.min(Math.max(Math.round(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const override = formats && formats.length > 0
  // Her niches, derived from her own reels when the column is empty — the same
  // "never make her type it" rule the formats override follows.
  const niches = topics && topics.length > 0
  let fit = override ? FIT.replaceAll('m.formats', '$2::text[]') : FIT
  let why = override ? MATCHED.replaceAll('m.formats', '$2::text[]') : MATCHED
  let gate = TOPIC_ALLOWED
  if (niches) {
    const slot = override ? '$3::text[]' : '$2::text[]'
    fit = fit.replaceAll('m.topics', slot)
    why = why.replaceAll('m.topics', slot)
    gate = gate.replaceAll('m.topics', slot)
  }
  const rows = await sql.query(
    `with ${SCORING_CTE}, ${ITEM_TAGS}
     select ranked.* from (
       select j.id, t.author, t.duration_sec, t.upload_date,
              (t.thumbnail is not null) as has_thumb,
              ${preview('t.plain', 150, 't.on_screen_text')} as preview,
              round((s.score / nullif(b.median_score, 0))::numeric, 2)::float as outperformance,
              (${fit})::float as fit,
              (${TASTE})::float as taste,
              ${why} as matched,
              ${alsoOn('j.id', 'm.id')} as also_on
         from transcriber.models m
         join transcriber.jobs j on j.status = 'done' and j.archived_at is null
         join item_tags g on g.job_id = j.id
         join transcriber.transcripts t on t.job_id = j.id
         left join scored   s on s.job_id = t.job_id
         left join baseline b on b.author = t.author
        where m.id = $1 and ${NOT_REFUSED} and ${NOT_ASSIGNED} and ${NOT_DECLINED} and ${gate}
     ) ranked
      where ranked.fit >= ${MIN_FIT} and ${EXPLAINABLE}
      order by ranked.fit desc, ranked.outperformance desc nulls last, ranked.upload_date desc
      limit ${capped * SOLO_HEADROOM}`,
    [modelId, ...(override ? [formats] : []), ...(niches ? [topics] : [])],
  )
  // A solo model is never offered a reel that needs someone else on camera —
  // `appendItems` would refuse it anyway, and a planner that picks what then
  // gets refused hands her a short week.
  const [who] = await sql.query(`select coalesce(solo, true) as solo from transcriber.models where id = $1`, [modelId])
  const needsOthers = who?.solo === false ? new Set<string>() : await jobsNeedingOthers(rows.map((row) => String(row.id)))
  return rows.filter((row) => !needsOthers.has(String(row.id))).slice(0, capped)
}
