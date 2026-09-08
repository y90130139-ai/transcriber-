/** What the "×" on a card actually means.
 *
 *  `outperformance` is a post's engagement score divided by the median of
 *  everything that same creator has in the library. 1.4 reads as "40% better
 *  than this creator normally does"; 0.02 as "a dud, 2% of normal". Measuring
 *  against a creator's own baseline rather than a global one is what lets a
 *  400-follower account and a 400k one sit in the same grid and be compared.
 *
 *  This module exists because the number was rendered in four places with the
 *  explanation in none of them, and it is the highest-signal field in the
 *  library. The wording lives here so the four sites cannot drift.
 */
import { HOT_THRESHOLD, HOT_WINDOW_DAYS, MIN_POSTS_FOR_HOT } from './hot'

/** The standing legend. Rendered visibly, because a `title` tooltip does
 *  nothing on a phone and the phone is where this gets read. */
export const OUTPERFORMANCE_LEGEND =
  `× compares a post to its own creator's median (likes + 10 × comments): ` +
  `1.0× is normal for them, 2.0× is twice their usual, 0.1× is a flop. ` +
  `🔥 marks ${HOT_THRESHOLD}× or better in the last ${HOT_WINDOW_DAYS} days, ` +
  `for creators with at least ${MIN_POSTS_FOR_HOT} posts to take a median from.`

/** Per-value wording for a hover tooltip on desktop. */
export function explainOutperformance(value: number): string {
  const pct = Math.round(Math.abs(value - 1) * 100)
  const sense =
    value >= 1.05 ? `${pct}% above` : value <= 0.95 ? `${pct}% below` : 'level with'
  return `${value}× — ${sense} this creator's own median (likes + 10 × comments).`
}
