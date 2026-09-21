/**
 * The Double Down ladder — one winner, five cards, one variable at a time.
 *
 * The manual's rule, and the reason the whole thing works:
 *
 *   A reskin = the same concept with exactly ONE of these changed —
 *   outfit, location, hook wording, prop, lighting, camera angle,
 *   reaction line, the object picked up, the background.
 *   The concept ALWAYS stays the same.
 *
 * And the batch rule underneath it: 2 identical re-records, then 3 with one
 * variable changed. Never two variables at once, because the point of the
 * exercise is not more posts — it is knowing *which* thing caused the result.
 * Change the outfit and the location together and a lift tells you nothing.
 *
 * So a winner does not produce "five more like that". It produces a batch: two
 * controls and three of a single axis, and the axis moves on next time. Three
 * batches in, her account has answered whether her outfits, her backgrounds or
 * her hooks are what her audience is actually responding to — which is the
 * thing the manual calls finding her brand.
 *
 * Edit Reskins (re-cutting the same clip, every 3 days) and Trial Reels are
 * deliberately **not** here: neither needs her to film anything, and at up to
 * 105 trial reels a week they would bury the cards that do. They get their own
 * queues. Decision recorded in docs/CREATIVE-DIRECTOR.md.
 */
import type { BankPost } from './bank'

/** The axes, in the order the manual runs them. Outfit first because it is the
 *  cheapest thing for her to change and the manual's own first batch. */
export const AXES = ['outfit', 'location', 'hook'] as const
export type Axis = (typeof AXES)[number]

/** How many controls and how many variants make one batch. */
export const CONTROLS = 2
export const VARIANTS = 3

export const AXIS_LABEL: Record<Axis, string> = {
  outfit: 'Outfit',
  location: 'Location',
  hook: 'Hook',
}

/** What she is told to hold still, per axis. Written to her, not about her. */
const HOLD: Record<Axis, string> = {
  outfit: 'Same location, same hook, same delivery. Only the outfit changes.',
  location: 'Same outfit, same hook, same delivery. Only the background changes.',
  hook: 'Same outfit, same location, same delivery. Only the opening line changes.',
}

const CHANGE: Record<Axis, string> = {
  outfit: 'Film it again in a different outfit — same energy, different clothes.',
  location: 'Film it again somewhere else. Outside, a different room, a different wall.',
  hook: 'Film it again with a different opening line. Same idea, new first words.',
}

export type Rung = {
  /** 1-based within the batch: the controls first, then the variants. */
  step: number
  kind: 'control' | 'variant'
  axis: Axis | null
  /** The single sentence that goes on the card. */
  instruction: string
  /** What must not move, so a result can be attributed to something. */
  hold: string
}

export type Ladder = {
  source: BankPost
  axis: Axis
  rungs: Rung[]
}

/**
 * The batch for one winner.
 *
 * `axis` is passed in rather than chosen here: which variable to test is a
 * property of what her account has already answered, not of the post, and the
 * planner is what knows how many batches she has run.
 */
export function ladderFor(source: BankPost, axis: Axis): Ladder {
  const rungs: Rung[] = []
  for (let i = 0; i < CONTROLS; i += 1) {
    rungs.push({
      step: rungs.length + 1,
      kind: 'control',
      axis: null,
      instruction:
        'Re-record this exactly as it was. Same outfit, same place, same delivery, same words.',
      hold: 'Nothing changes. This is the control — it is what the others are measured against.',
    })
  }
  for (let i = 0; i < VARIANTS; i += 1) {
    rungs.push({
      step: rungs.length + 1,
      kind: 'variant',
      axis,
      instruction: CHANGE[axis],
      hold: HOLD[axis],
    })
  }
  return { source, axis, rungs }
}

/** Which axis a model's next batch should test.
 *
 *  Rotates through outfit → location → hook by how many batches she has
 *  already run, so a model does not spend a month learning about outfits and
 *  nothing about her openings. */
export function nextAxis(batchesRun: number): Axis {
  return AXES[batchesRun % AXES.length]
}

/** How many cards one winner is worth. */
export const RUNGS_PER_WINNER = CONTROLS + VARIANTS
