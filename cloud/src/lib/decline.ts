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
