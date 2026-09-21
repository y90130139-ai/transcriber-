/**
 * The 70/20/10 planner — the first thing here allowed to *pick*.
 *
 * `mix.ts` measures the split and deliberately does not choose; that line was
 * drawn because changing how winners are chosen and what they are measured
 * against in one step is how a system stops being explainable. This is the
 * other side of that line, and it picks only from measurements it did not
 * invent: `bank.ts` grades her own posts, `match.ts` ranks the library.
 *
 *   70%  Reskins     her winners, run through the Double Down ladder
 *   20%  Iterations  her 3-10x posts, run again to see if they promote
 *   10%  New Tests   the library — other creators' proven concepts
 *
 * At her weekly target of 21 that is 15 / 4 / 2.
 *
 * **What this replaces:** today every card comes from the library, which in the
 * manual's vocabulary means every card is a New Test. The 10% was the whole
 * plan. Sized correctly, the library stops being the plan and becomes the
 * experiment budget — which is what it was always good at.
 *
 * **When her bank is empty** — a new model, or one the roster pass has not
 * reached — the week falls back to the library and says so. That is the
 * manual's own answer (small creator: test first, collect data, then brand),
 * and it is the honest one: with no history there is nothing to reskin. What
 * it must never do is fall back silently, because then a bank that failed to
 * fill looks exactly like a model who is doing fine.
 */
import { bankFor, type Bank, type BankPost } from './bank'
import { ladderFor, nextAxis, RUNGS_PER_WINNER, type Axis, type Rung } from './ladder'
import { suggestionsFor } from './match'
import { sql } from './db'
import { TARGET_MIX } from './mix'
import { schedule, scheduleSummary, type Scheduled } from './schedule'

export type Bucket = 'reskin' | 'iteration' | 'test'

export type Counts = Record<Bucket, number>

/** How many of each bucket a week of `target` reels wants.
 *
 *  Rounded so the buckets always sum to the target exactly: reskins take the
 *  remainder, because the manual is emphatic that the 70% is the one that
 *  must not be shorted. At 21 this gives the manual's own 15 / 4 / 2. */
export function countsFor(target: number): Counts {
  const total = Math.max(0, Math.round(target))
  const iteration = Math.round(total * TARGET_MIX.iteration)
  const test = Math.round(total * TARGET_MIX.test)
  return { reskin: Math.max(0, total - iteration - test), iteration, test }
}

export type PlannedCard = {
  bucket: Bucket
  /** Her own post this card recreates, for a reskin or an iteration. */
  source_post: string | null
  source_url: string | null
  source_plays: number | null
  source_multiple: number | null
  /** The library item to film, for a new test. */
  job_id: string | null
  /** The single variable under test. Null on controls and on library cards. */
  axis: Axis | null
  /** What she does, in one line. */
  instruction: string
  /** What must not move, so the result means something. */
  hold: string | null
}

export type Week = {
  model_id: string
  name: string
  target: number
  counts: Counts
  /** What was actually filled — short of `counts` when the sources ran dry. */
  filled: Counts
  cards: Scheduled[]
  /** The week in a sentence, for the top of her plan. */
  summary: string
  bank: { winners: number; iterations: number; empty: boolean; accounts: Bank['accounts'] }
  /** Said out loud rather than papered over. */
  notes: string[]
}

/** Her week, proposed. Reads only; nothing is written until a human says so. */
export async function weekFor(modelId: string): Promise<Week | null> {
  const [model] = await sql.query(
    `select id, name, coalesce(weekly_target, 21) as target
       from transcriber.models where id = $1`,
    [modelId],
  )
  if (!model) return null

  const target = Number(model.target) || 21
  const counts = countsFor(target)
  const bank = await bankFor(modelId)
  const notes: string[] = []
  const cards: PlannedCard[] = []

  if (!bank || bank.empty) {
    notes.push(
      'No baseline yet: none of her accounts has enough recent reels with play ' +
      'counts to take a median from. Until the roster pass fills that in, there ' +
      'is nothing of hers to reskin, so the whole week comes from the library ' +
      'as new tests — the manual\'s own answer for a creator with no history.',
    )
  }

  // Reskins. Each winner is a batch of five: two controls and three of one
  // axis. Whole batches only — half a batch answers nothing, and the controls
  // are the half that would get dropped.
  const winners = bank?.winners ?? []
  let batches = await batchesRun(modelId)
  for (const winner of winners) {
    if (cards.filter(is('reskin')).length + RUNGS_PER_WINNER > counts.reskin) break
    const ladder = ladderFor(winner, nextAxis(batches))
    batches += 1
    for (const rung of ladder.rungs) cards.push(fromRung(winner, rung))
  }

  const reskins = cards.filter(is('reskin')).length
  if (winners.length > 0 && reskins < counts.reskin) {
    const room = counts.reskin - reskins
    notes.push(
      `${reskins} of ${counts.reskin} reskin slots filled from ${winners.length} ` +
      `winner${winners.length === 1 ? '' : 's'}. A winner is worth ${RUNGS_PER_WINNER} cards ` +
      `and only whole batches are drafted, so ${room} slot${room === 1 ? '' : 's'} went to ` +
      'the other buckets rather than shipping half a batch.',
    )
  }

  // Iterations: her medium performers, run again as they were. No axis — the
  // question an iteration asks is whether the post was under-served, not which
  // variable matters.
  for (const post of (bank?.iterations ?? []).slice(0, counts.iteration)) {
    cards.push({
      bucket: 'iteration',
      source_post: post.post_id,
      source_url: post.url,
      source_plays: post.plays,
      source_multiple: post.multiple,
      job_id: null,
      axis: null,
      instruction:
        'Run this one again as it was. It did well without breaking out — a second ' +
        'go tells us whether it was the idea or the day.',
      hold: 'Same concept. Change nothing on purpose.',
    })
  }

  // New tests: the library, sized at whatever the first two buckets left. The
  // fallback path lands here too, which is why it asks for the full target.
  const wantTests = target - cards.length
  if (wantTests > 0) {
    const picks = await suggestionsFor(modelId, Math.min(wantTests * 2, 40))
    for (const pick of picks.slice(0, wantTests)) {
      cards.push({
        bucket: 'test',
        source_post: null,
        source_url: null,
        source_plays: null,
        source_multiple: null,
        job_id: String(pick.id),
        axis: null,
        instruction: 'New concept. Recreate the structure — your outfit, your place, your words.',
        hold: null,
      })
    }
    if (picks.length === 0) {
      notes.push(
        'The library returned nothing for her. That is a profile with no format ' +
        'or persona tags rather than an empty library: a pick has to be ' +
        'explainable by at least one tag she carries.',
      )
    }
  }

  const filled: Counts = {
    reskin: cards.filter(is('reskin')).length,
    iteration: cards.filter(is('iteration')).length,
    test: cards.filter(is('test')).length,
  }
  const total = filled.reskin + filled.iteration + filled.test
  if (total < target) {
    notes.push(`${total} of ${target} cards filled. The sources ran dry, not the week.`)
  }

  const laid = schedule(cards)

  return {
    model_id: String(model.id),
    name: String(model.name),
    target,
    counts,
    filled,
    cards: laid,
    summary: scheduleSummary(laid),
    bank: {
      winners: winners.length,
      iterations: bank?.iterations.length ?? 0,
      empty: bank?.empty ?? true,
      accounts: bank?.accounts ?? [],
    },
    notes,
  }
}

const is = (bucket: Bucket) => (card: PlannedCard) => card.bucket === bucket

function fromRung(source: BankPost, rung: Rung): PlannedCard {
  return {
    bucket: 'reskin',
    source_post: source.post_id,
    source_url: source.url,
    source_plays: source.plays,
    source_multiple: source.multiple,
    job_id: null,
    axis: rung.axis,
    instruction: rung.instruction,
    hold: rung.hold,
  }
}

/** How many ladder batches she has already been sent, so the axis rotates
 *  rather than testing outfits forever. Counts distinct source posts that have
 *  reached a plan, which is one batch each by construction. */
async function batchesRun(modelId: string): Promise<number> {
  const [row] = await sql.query(
    `select count(distinct i.source_post)::int as batches
       from transcriber.plan_items i
       join transcriber.plans p on p.id = i.plan_id
      where p.model_id = $1 and i.source_post is not null`,
    [modelId],
  )
  return Number(row?.batches ?? 0)
}
