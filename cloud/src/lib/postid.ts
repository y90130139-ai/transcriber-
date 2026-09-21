/**
 * When a post went up, read out of its own shortcode.
 *
 * The sweep reads two tabs and merges them: the timeline carries `taken_at`,
 * the reels tab carries the play count. They overlap far less than the design
 * assumed — measured 2026-09-21 on one account, 2 of 28 reels appeared on
 * both — so the newest reels, the ones that matter most, arrived with plays
 * and no date. 1,429 rows over 124 handles, exactly one reels page each.
 *
 * The reels tab does not carry a date field at all (probed: no `taken_at`, no
 * timestamp of any name). But it does not need to. A shortcode is the post's
 * numeric id in base64, and Instagram's ids put milliseconds since their own
 * epoch in the top bits. Measured against 500 posts with a real `taken_at`:
 *
 *   344 within a minute · 460 within an hour · 475 within a day
 *
 * and the misses run one way: 154 read *earlier* than the real post, 1 read
 * later. The id is minted when the upload starts, not when it goes live, so a
 * draft or a scheduled post carries an older id than its post date. That
 * direction is the safe one — a derived date can make a post look older and
 * fall out of a 30-day window; it essentially never drags a stale post in.
 *
 * Every date made this way is stored as `posted_at_source = 'id'`, so a real
 * `taken_at` always replaces it and nothing downstream has to guess which one
 * it is holding.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Instagram's id epoch. The measured median offset sat 36 seconds from it. */
const EPOCH_MS = 1_314_220_021_721n

/** Past eleven characters a shortcode carries a suffix, not more of the id. */
const ID_CHARS = 11

/** Before this, a "date" out of an id is a decoding error, not a post. */
const EARLIEST = Date.UTC(2012, 0, 1)

/** The id a shortcode encodes, or null when it is not a shortcode. */
export function idOf(code: string): bigint | null {
  if (!code) return null
  let n = 0n
  for (const ch of code.slice(0, ID_CHARS)) {
    const digit = ALPHABET.indexOf(ch)
    if (digit < 0) return null
    n = n * 64n + BigInt(digit)
  }
  return n
}

/** When the post was created, from its shortcode alone — ISO, or null. */
export function dateFromShortcode(code: string): string | null {
  const id = idOf(code)
  if (id === null) return null
  const ms = Number((id >> 23n) + EPOCH_MS)
  // Outside Instagram's lifetime is a bad decode, and a wrong date is worse
  // than no date: it would put the post in a window it never belonged to.
  if (!Number.isFinite(ms) || ms < EARLIEST || ms > Date.now() + 86_400_000) return null
  return new Date(ms).toISOString()
}

export type DateSource = 'taken_at' | 'id'
