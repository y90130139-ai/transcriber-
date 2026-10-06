/**
 * Her week in two piles: what she has said yes to, and what still wants an
 * answer (Geno, 2026-10-06 — scrolling one long mixed feed made it "confusing
 * to have to scroll through a bunch of the reels"; she should verify each idea
 * before it joins her list).
 *
 *   to review   nobody has answered — the cards waiting on her yes or no
 *   my reels    hers now: she tapped "I'll do this", marked it made, or
 *               simply filmed it without ever answering (a filmed card is
 *               the loudest yes there is)
 *
 * Declined cards are neither — they live in "Videos you can't do", exactly
 * as before. Pure and import-free so the page and the tests read one rule.
 */

export type Bucketed = {
  verdict: 'open' | 'accepted' | 'declined'
  filmed: boolean
}

export type PlanBucket = 'review' | 'mine'

export function bucketOf(item: Bucketed): PlanBucket {
  if (item.verdict === 'accepted' || item.filmed) return 'mine'
  return 'review'
}

/** Split in one pass, keeping each pile in the plan's own order. */
export function splitByBucket<T extends Bucketed>(items: T[]): { review: T[]; mine: T[] } {
  const review: T[] = []
  const mine: T[] = []
  for (const item of items) (bucketOf(item) === 'mine' ? mine : review).push(item)
  return { review, mine }
}
