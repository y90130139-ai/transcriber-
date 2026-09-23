/**
 * Why a card did not get filmed, in five buckets.
 *
 * A decline was never a dead end — the reason has always been stored and the
 * console already offers a scored replacement for a declined card. What was
 * missing is that the reason is free prose, so it could not be counted. Three
 * "nowhere to film" in a row is a fact about her house; as three sentences it
 * reads as three bad weeks.
 *
 * This sits *beside* the textarea, never instead of it. Her own words are
 * usually the useful part, and no five-item list will ever hold everything a
 * week can go wrong in — which is what `other` is for, and why `other` still
 * expects the box underneath to say something.
 *
 * No imports on purpose: her page renders this in a client component, and the
 * console counts it on the server.
 */
export const DECLINE_CODES = [
  'nowhere-to-film',
  'wrong-outfit',
  'not-comfortable',
  'no-time',
  'other',
] as const

export type DeclineCode = (typeof DECLINE_CODES)[number]

/** In her words, not ours — this is a button on her phone, not a database
 *  value she should ever have to recognise. */
export const DECLINE_LABEL: Record<DeclineCode, string> = {
  'nowhere-to-film': 'Nowhere to film it',
  'wrong-outfit': 'Not the right outfit',
  'not-comfortable': 'Not comfortable with it',
  'no-time': 'No time this week',
  other: 'Something else',
}

export const isDeclineCode = (value: unknown): value is DeclineCode =>
  typeof value === 'string' && (DECLINE_CODES as readonly string[]).includes(value)

/**
 * Which "no" is forever, and which is only for now.
 *
 * Geno's rule, 2026-09-23:
 *
 *   not comfortable   permanent — she is saying the idea is not her, and
 *                     sending it back later is how a model stops reading her
 *                     plan at all
 *   wrong outfit      permanent — what she owns and will wear is not a mood
 *   something else    permanent — she had to write what it was, so it is a
 *                     reason somebody can read rather than a shrug
 *   nowhere to film   21 days — her place may change, but not by much and
 *                     not quickly
 *   no time           21 days — a bad week is not a bad idea
 */
export const PERMANENT_DECLINES: readonly DeclineCode[] = ['not-comfortable', 'wrong-outfit', 'other']

export function isPermanentDecline(code: unknown): boolean {
  return isDeclineCode(code) && PERMANENT_DECLINES.includes(code)
}

/** How long circumstance keeps a reel off her week before it may come round
 *  once more. Three weeks: past "this week" by any reading, and short enough
 *  that a good reel is not lost to one busy stretch. */
export const DECLINE_COOLDOWN_DAYS = 21

/** "Something else" is not an answer on its own — it is the one code that
 *  tells us nothing, so it has to come with her words. */
export function needsReason(code: unknown): boolean {
  return code === 'other'
}
