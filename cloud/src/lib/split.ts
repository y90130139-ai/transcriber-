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
import { unfetchable } from './hers'
import { TARGET_MIX } from './mix'
import { schedule, scheduleSummary, type Scheduled } from './schedule'
import { RELATABLE } from './taxonomy'
import { STARTER_VERTICALS, effectiveFormats, levelFor, topicsFor, verticalsFor, type Level } from './insights'

/** The manual's onboarding testing round: 6 reels, feedback, then 15 — before
 *  any branded week. Only for a creator the level read calls new; the manual is
 *  explicit that a bigger creator should be personalised immediately. */
export const TESTING_ROUNDS = [6, 15] as const

/** At most this many relatable reels in one week — Geno's call, 2026-09-22.
 *  They fit everyone, so without a cap the same handful of twistable reels
 *  would land in every model's week and her own niche would be crowded out. */
const MAX_RELATABLE = 2

/** A pick the matcher could explain only as "relatable" — the reel that is
 *  about nothing in particular and travels on its shape. */
function isRelatable(pick: { matched?: unknown }): boolean {
  return Array.isArray(pick.matched) && pick.matched.includes(RELATABLE)
}

export type Bucket = 'reskin' | 'iteration' | 'test'

/** A relatable reel's card: keep the shape, change the subject. */
export const TWIST = 'twist'
export type TwistAxis = typeof TWIST

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
  /** The single variable under test. Null on controls and on library cards.
   *  `twist` on a relatable reel: not a variable, but the one thing that has
   *  to change about it — what it is about. */
  axis: Axis | TwistAxis | null
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
  /** Where she is in the manual's sequence, and what she is matched on. */
  level: Level
  /** 1 or 2 during the testing round, null once she is past it. */
  testing_round: number | null
  matched_on: { formats: string[]; basis: 'her-profile' | 'derived' | 'starter' }
  /** Said out loud rather than papered over. */
  notes: string[]
}

/** Her week, proposed. Reads only; nothing is written until a human says so. */
export async function weekFor(modelId: string): Promise<Week | null> {
  const [model] = await sql.query(
    `select m.id, m.name, coalesce(m.weekly_target, 21) as target, m.persona, m.formats, m.topics,
            (select count(*)::int from transcriber.plans p
              where p.model_id = m.id and p.status = 'sent') as sent
       from transcriber.models m where m.id = $1`,
    [modelId],
  )
  if (!model) return null

  const bank = await bankFor(modelId)
  const notes: string[] = []
  const cards: PlannedCard[] = []

  // What to match her on. Her typed formats when anyone typed them; otherwise
  // what her own winners say, and the manual's three starters under that —
  // never nothing, because nothing is what left 9 models without a plan.
  const persona = (model.persona as string[]) ?? []
  const verticals = bank ? await verticalsFor(modelId, bank, persona) : []
  const matchedOn = effectiveFormats((model.formats as string[]) ?? [], verticals)
  const override = matchedOn.basis === 'her-profile' ? undefined : matchedOn.formats

  // The testing round, for a creator who reads as new and has not had two
  // weeks sent yet. Everything in it is a new test on the starter verticals:
  // there is no brand to build from until she has filmed something.
  // Her niches: the column when a human set it, otherwise what her own reels
  // say. A golf model gets golf reels without anyone typing "golf".
  const typedTopics = (model.topics as string[]) ?? []
  const niches = typedTopics.length > 0 ? typedTopics : await topicsFor(modelId)

  const level = bank ? (await levelFor(modelId, bank)).level : 'new'
  const sent = Number(model.sent ?? 0)
  // New *and* nothing to go on. The round exists to collect data, so a small
  // account that already has winners has done its testing on Instagram's dime —
  // Faye, at 9k followers with three reels past 10x, is the case that showed it.
  const hasWinners = (bank?.winners.length ?? 0) > 0
  const testingRound = level === 'new' && !hasWinners && sent < TESTING_ROUNDS.length ? sent + 1 : null
  const target = testingRound ? TESTING_ROUNDS[testingRound - 1] : Number(model.target) || 21
  const counts: Counts = testingRound ? { reskin: 0, iteration: 0, test: target } : countsFor(target)
  if (testingRound === 1) {
    notes.push(
      'Testing round 1 of 2: six reels across the three starter verticals, then ' +
      'feedback before anything else is sent. The point is to see how she looks, ' +
      'talks and moves on camera — not to brand her yet.',
    )
  } else if (testingRound === 2) {
    notes.push('Testing round 2 of 2: fifteen more, shaped by what the first six showed.')
  }

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
  const graded = [...(bank?.winners ?? []), ...(bank?.iterations ?? [])]
  const blocked = await unfetchable(graded.map((post) => post.post_id))
  const fetchable = (post: BankPost) => !blocked.has(post.post_id)
  if (!testingRound && blocked.size > 0) {
    notes.push(
      `${blocked.size} of her graded reel${blocked.size === 1 ? '' : 's'} could not be ` +
      'downloaded — Instagram age-restricts them — so they were passed over for the next best.',
    )
  }
  const winners = testingRound ? [] : (bank?.winners ?? []).filter(fetchable)
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
  for (const post of (testingRound ? [] : (bank?.iterations ?? []).filter(fetchable)).slice(0, counts.iteration)) {
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
    const formats = testingRound ? [...STARTER_VERTICALS] : override
    const picks = await suggestionsFor(modelId, Math.min(wantTests * 2, 40), formats, niches)
    // Relatable reels suit everybody, which is exactly why they are rationed:
    // left alone they would outrank her own niche and every model would get
    // the same week. Her matches come first; these fill what is left, capped.
    let relatable = 0
    const chosen: typeof picks = []
    for (const pick of picks) {
      if (chosen.length >= wantTests) break
      if (isRelatable(pick)) {
        if (relatable >= MAX_RELATABLE) continue
        relatable += 1
      }
      chosen.push(pick)
    }
    for (const pick of chosen) {
      cards.push({
        bucket: 'test',
        source_post: null,
        source_url: null,
        source_plays: null,
        source_multiple: null,
        job_id: String(pick.id),
        axis: isRelatable(pick) ? TWIST : null,
        instruction: isRelatable(pick)
          // The Adam Sandler case: the reel is not about her world and does not
          // need to be. What travels is the shape — the setup, the beat, the
          // turn — and the subject is swapped for something she would say.
          ? 'This one is not about your world — it works because of how it is built. ' +
            'Keep the structure and the timing, and change what it is about to something ' +
            'from your life. Your words, your subject.'
          : 'New concept. Recreate the structure — your outfit, your place, your words.',
        hold: null,
      })
    }
    if (niches.length > 0 && picks.length > 0) {
      notes.push(
        `Matched on her niche — ${niches.join(', ')} — ` +
        (typedTopics.length > 0 ? 'set for her.' : 'read off her own reels; nobody typed it.'),
      )
    }
    if (relatable > 0) {
      notes.push(
        `${relatable} of the new ${relatable === 1 ? 'test is a' : 'tests are'} relatable ` +
        `${relatable === 1 ? 'reel' : 'reels'} rather than ${relatable === 1 ? 'a reel' : 'reels'} ` +
        'from her own niche — kept to a twist of the format, not a copy of the subject.',
      )
    }
    if (picks.length === 0) {
      notes.push(
        `The library returned nothing on ${matchedOn.formats.map((f) => f).join(', ')}. ` +
        'That is a library short of those formats, not a profile problem — tag more ' +
        'references in them, or accept different verticals for her.',
      )
    }
    if (override && picks.length > 0 && !testingRound) {
      notes.push(
        matchedOn.basis === 'derived'
          ? 'Matched on the verticals her own winners point to — nobody has typed a profile for her.'
          : 'Matched on the manual\'s three starter verticals — she has no profile and no winners to derive one from yet.',
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
    level,
    testing_round: testingRound,
    matched_on: matchedOn,
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
