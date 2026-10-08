/**
 * Writing the 70/20/10 week onto her plan.
 *
 * `split.ts` proposes and this writes, kept apart on purpose: everything else
 * here that decides something (`candidates`, `previewBatch`) can be read
 * before it acts, and a planner that both chose and wrote would be the one
 * thing in the pipeline nobody could check first.
 *
 * Every card still goes through `appendItems`, so it inherits the same drafted
 * brief a library card has always had — direction, wardrobe, camera, takes,
 * sound, hook, caption. What this adds on top is the part the brief cannot
 * know: which bucket the card belongs to, which single variable is under test,
 * which of her own posts it recreates, and when it goes out.
 *
 * Those travel *into* the insert rather than being stamped on after it. A
 * ladder is the same job five times and the unique index is partial on
 * `source_post is null`, so a rung that landed without its source would
 * collide with the rung before it and disappear without a word.
 *
 * A reskin card points at **her own reel's** library row, so her portal shows
 * her the video she is being asked to remake. That is the whole reason her
 * winners are ingested: "recreate this" with nothing to rewatch is how a card
 * comes back filmed wrong.
 */
import { nanoid } from 'nanoid'
import { sql } from './db'
import { addDays } from './dates'
import { appendItems } from './models'
import { jobsForPosts } from './hers'
import { weekFor, type Week } from './split'

/** Same offset a hand-opened week uses. */
const DUE_OFFSET_DAYS = 7
/** How long a reel stays out of her pool after being on one of her weeks. */
const REPEAT_COOLDOWN_DAYS = 42

/**
 * The top of her week, in her words.
 *
 * Her page opened with nothing: `plans.title` and `plans.intro` were never
 * drafted, so unless someone typed them she got a wall of cards and no idea
 * why any of them were there. This is the one place to say what the week *is*.
 *
 * Deliberately without the vocabulary we use between ourselves. "Reskin" is
 * our word for it; what she needs to know is that five of these are versions
 * of a reel that already worked for her, that two of them are identical on
 * purpose, and that the point of holding everything else still is that it is
 * the only way to learn what actually moved the numbers.
 */
export function draftIntro(cards: Week['cards']): { title: string; intro: string } {
  const lines: string[] = []
  const reskins = cards.filter((card) => card.bucket === 'reskin')
  const iterations = cards.filter((card) => card.bucket === 'iteration').length
  const tests = cards.filter((card) => card.bucket === 'test').length

  if (reskins.length > 0) {
    // One batch per winner, each testing its own variable, so the intro has to
    // speak to however many there are rather than assume one.
    const batches = new Map<string, { multiple: number | null; axis: string | null }>()
    for (const card of reskins) {
      const key = card.source_post ?? ''
      const seen = batches.get(key) ?? { multiple: card.source_multiple, axis: null }
      if (card.axis) seen.axis = card.axis
      batches.set(key, seen)
    }
    const list = [...batches.values()]
    const best = Math.max(...list.map((batch) => batch.multiple ?? 0))
    const axes = [...new Set(list.map((batch) => batch.axis).filter((axis): axis is string => Boolean(axis)))]
    const winners = list.length === 1
      ? `your reel that did ${best >= 10 ? `${Math.round(best)}×` : 'far better than'} your normal`
      : `your ${list.length} best reels — the top one did ${Math.round(best)}× your normal`
    lines.push(
      `${reskins.length} of these are ${winners}, again. For each one, the first two ` +
      'are exactly as it was, on purpose: they are what the rest get measured against. ' +
      'The other three change one thing and nothing else' +
      (axes.length ? ` — ${axes.join(', then ')} — ` : ' ') +
      'because one change at a time is the only way to find out what actually made it work.',
    )
  }
  if (iterations > 0) {
    lines.push(
      `${iterations} did well without taking off. Worth one more go to see whether ` +
      'it was the idea or the day.',
    )
  }
  if (tests > 0) {
    lines.push(
      `${tests} ${tests === 1 ? 'is a' : 'are'} new — ideas working right now for ` +
      'accounts like yours. Make them yours: your outfit, your place, your words.',
    )
  }

  return {
    title: `${cards.length} reels`,
    intro: lines.join(' '),
  }
}

export type DraftResult = {
  model_id: string
  name: string
  week_of: string
  plan_id: string
  created: boolean
  written: number
  /** Cards that could not be written, and the honest reason. */
  skipped: { bucket: string; why: string }[]
  week: Week
}

/**
 * Draft her week from the split.
 *
 * Only ever produces a **draft** plan — the same safety argument the autodraft
 * runs on. Nothing reaches her until a human marks the week sent.
 */
export async function draftWeek(modelId: string, weekOf: string): Promise<DraftResult | null> {
  // Once per week, ever. A ladder's cards are allowed to repeat the same job —
  // that is the point of a ladder — so drafting the same week twice would lay a
  // second copy of every batch on top of the first. The unique index cannot
  // catch it, so this has to.
  if (await alreadyDrafted(modelId, weekOf)) return null
  // A sent week is on her phone. Appending to it would put cards in front of
  // her that nobody reviewed — Blair's and Ria's weeks of 2026-09-21 were one
  // button away from that.
  if (await alreadySent(modelId, weekOf)) return null
  // Custom template (2026-10-08): the team builds this model's weeks by hand,
  // and a drafted card landing under theirs is exactly what they opted out of.
  const [who] = await sql.query(
    `select plan_template from transcriber.models where id = $1`, [modelId],
  )
  if (who?.plan_template === 'custom') return null
  const week = await weekFor(modelId)
  if (!week) return null

  const [plan] = await sql.query(
    `insert into transcriber.plans (id, model_id, week_of, due_date)
     values ($1, $2, $3::date, $4::date)
     on conflict (model_id, week_of) do update set updated_at = now()
     returning id, (xmax = 0) as created`,
    [newId(), modelId, weekOf, addDays(weekOf, DUE_OFFSET_DAYS)],
  )
  const planId = String(plan.id)

  // Her own posts reach the library like anything else, but the row is found
  // by shortcode rather than by job id — the card knows which post it
  // recreates, not which job holds it.
  const sources = [...new Set(week.cards.map((card) => card.source_post).filter(isText))]
  const jobs = await jobsForPosts(sources)

  // A reel she was already asked for recently never comes back by itself
  // (Geno, 2026-10-07: Nina's one winner was re-laid every single week).
  // Six weeks of her plans are out of the pool; when the pool runs dry the
  // week is honestly shorter rather than quietly repetitive.
  const priorRows = await sql.query(
    `select distinct i.job_id
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1 and i.job_id is not null
        and p.week_of >= $2::date - ${REPEAT_COOLDOWN_DAYS} and p.week_of < $2::date`,
    [modelId, weekOf],
  )
  const recent = new Set(priorRows.map((row) => String(row.job_id)))

  const skipped: DraftResult['skipped'] = []
  const landed: Week['cards'] = []
  let written = 0

  for (const card of week.cards) {
    const jobId = card.job_id ?? (card.source_post ? jobs.get(card.source_post) ?? null : null)
    if (!jobId) {
      skipped.push({
        bucket: card.bucket,
        why: card.source_post
          ? `Their post ${card.source_post} is not in the library yet — ingest it first, ` +
            'or the card would ask them to recreate a video they cannot watch.'
          : 'No library item behind this card.',
      })
      continue
    }

    if (recent.has(jobId)) {
      skipped.push({ bucket: card.bucket, why: 'Was on one of her recent weeks — one ask per reel.' })
      continue
    }
    const added = await appendItems(planId, modelId, [jobId], () => ({
      bucket: card.bucket,
      axis: card.axis,
      source_post: card.source_post,
      source_url: card.source_url,
      hold: card.hold,
      slot_day: card.slot_day,
      slot_time: card.slot_time,
      // No lead in Direction: the card's Keep / Change / Your face block now
      // says what this card is for, and saying it twice pushed the actual
      // direction below the fold.
    }))
    if (added === 0) {
      skipped.push({ bucket: card.bucket, why: 'Already on this week.' })
      continue
    }
    written += 1
    landed.push(card)
  }

  // Described from what actually landed, not from what was proposed: a card
  // skipped for want of an ingested source must not be promised in the intro.
  // Filled in only, never replaced — whatever a human wrote wins, because the
  // one thing worse than an empty top-of-week is a drafted one that overwrote
  // the real one.
  if (landed.length > 0) {
    const opening = draftIntro(landed)
    await sql.query(
      `update transcriber.plans
          set title = coalesce(nullif(title, ''), $2),
              intro = coalesce(nullif(intro, ''), $3)
        where id = $1`,
      [planId, opening.title, opening.intro],
    )
  }

  return {
    model_id: week.model_id,
    name: week.name,
    week_of: weekOf,
    plan_id: planId,
    created: Boolean(plan.created),
    written,
    skipped,
    week,
  }
}

async function alreadyDrafted(modelId: string, weekOf: string): Promise<boolean> {
  const [row] = await sql.query(
    `select count(*)::int as n from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1 and p.week_of = $2::date and i.bucket is not null`,
    [modelId, weekOf],
  )
  return Number(row?.n ?? 0) > 0
}

async function alreadySent(modelId: string, weekOf: string): Promise<boolean> {
  const [row] = await sql.query(
    `select 1 from transcriber.plans
      where model_id = $1 and week_of = $2::date and status <> 'draft'`,
    [modelId, weekOf],
  )
  return Boolean(row)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const newId = () => nanoid(12)

export type RosterDraft = {
  weekOf: string
  opened: number
  added: number
  models: number
  /** Models whose week came up short, and by how much — the one thing worth
   *  reading when nobody was watching the run. */
  short: { name: string; short: number }[]
  /** Models not reached before the time budget ran out; the next call does them. */
  remaining: number
}

/** Stop starting new models after this, well inside a 60-second function. */
const ROSTER_BUDGET_MS = 40_000

/**
 * Every active model's week, drafted from the 70/20/10 split — what the
 * Sunday job runs. Replaces `previewBatch`/`writeBatch`, which built every
 * week from other creators' reels and so drafted the 10% as the whole plan.
 * Still drafts only: nothing reaches a model until a human marks it sent.
 */
export async function draftRoster(weekOf: string): Promise<RosterDraft> {
  const models = await sql.query(
    `select id from transcriber.models where status = 'active'
      order by priority nulls last, name`,
  )
  let opened = 0
  let added = 0
  let remaining = 0
  const short: RosterDraft['short'] = []
  const started = Date.now()
  for (const model of models) {
    // About five seconds a model, measured; the function has sixty. Stop with
    // room to spare and let the next call — the Mac's 17:00 run, or the cron
    // tomorrow — pick up where this left off. Already-drafted weeks are skipped.
    if (Date.now() - started > ROSTER_BUDGET_MS) { remaining += 1; continue }
    const result = await draftWeek(String(model.id), weekOf)
    if (!result) continue
    if (result.created) opened += 1
    added += result.written
    const gap = result.week.target - result.week.cards.length + result.skipped.length
    if (gap > 0) short.push({ name: result.name, short: gap })
  }
  return { weekOf, opened, added, models: models.length, short, remaining }
}
