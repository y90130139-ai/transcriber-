/**
 * Her week as days and slots, rather than a list of twenty-one.
 *
 * The manual's posting rules, and the reason each one exists:
 *
 *   3 reels a day at 10:00 / 13:00 / 18:00, local to her
 *   1-3 carousels a week, posted in the gaps
 *   never two posts inside an hour — they compete, and the algorithm
 *   pushes both of them less
 *
 * A flat list of cards cannot express any of that, which is why a plan reads
 * as a pile of homework: twenty-one things with no order and no when. The
 * cards are the same cards; giving each one a day and a slot is what turns
 * them into a week she can execute without deciding anything.
 *
 * The order within the week is deliberate. Reskins lead, because they are the
 * 70% and they are the least ambiguous thing to film — she has already made
 * that video once. Iterations follow. New tests land last, when she is warmed
 * up and a concept she has never shot is least likely to stall the day.
 *
 * Filming days are not posting days. This assigns *posting* slots; what she
 * shoots on a filming day is the whole week's worth in one sitting, which is
 * the manual's batch-shoot hack and already lives on `models.filming_days`.
 */
import type { Bucket, PlannedCard } from './split'

/** Local clock times, in the order they run. */
export const SLOTS = ['10:00', '13:00', '18:00'] as const
export type Slot = (typeof SLOTS)[number]

/** Between carousels and the reels either side of them. The rule is an hour;
 *  90 minutes is the midpoint of a three-hour gap and needs no arithmetic at
 *  the point of posting. */
export const CAROUSEL_SLOTS = ['11:30', '15:30'] as const

/** Days run Monday (0) to Sunday (6), the same as `week_of`. */
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Reskins first: the 70%, and the easiest thing to film twice. */
const ORDER: Record<Bucket, number> = { reskin: 0, iteration: 1, test: 2 }

export type Scheduled = PlannedCard & {
  slot_day: number
  slot_time: string
  /** "Monday 10:00" — what the card says at the top. */
  when: string
}

/** Seven days of three. What a week holds before anything has to double up. */
export const WEEK_SLOTS = DAYS.length * SLOTS.length

/**
 * Lay the cards across the week.
 *
 * Every day's three main slots first, across all seven days, and only then the
 * in-between times — so a 21-reel week never touches them and a heavier week
 * spreads its extras rather than stacking two posts on one morning. The rule
 * that must not break is two posts inside an hour, which is why the overflow
 * times are the midpoints and not simply "10:00 again".
 *
 * A week bigger than the 35 slots that leaves is not silently compressed: the
 * remainder rolls into the following week's Monday, where it is visible.
 */
export function schedule(cards: PlannedCard[]): Scheduled[] {
  const ordered = [...cards].sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket])
  // Built in the order it is used, because every sort of this that looked
  // right gave one day five posts and another none.
  //
  //   the three main slots, day by day     — three a day across the whole week
  //   then 11:30 Monday through Sunday     — the first extra spreads before
  //   then 15:30 Monday through Sunday       any day takes a second one
  const slots: { day: number; time: string }[] = []
  for (let day = 0; day < DAYS.length; day += 1) {
    for (const time of SLOTS) slots.push({ day, time })
  }
  for (const time of CAROUSEL_SLOTS) {
    for (let day = 0; day < DAYS.length; day += 1) slots.push({ day, time })
  }

  return ordered.map((card, index) => {
    const slot = slots[index % slots.length]
    const week = Math.floor(index / slots.length)
    const day = slot.day + week * DAYS.length
    return {
      ...card,
      slot_day: day,
      slot_time: slot.time,
      when: `${week ? 'Next ' : ''}${DAYS[slot.day]} ${slot.time}`,
    }
  })
}

/** How the week reads back as a sentence, for the top of her plan. */
export function scheduleSummary(cards: Scheduled[]): string {
  if (cards.length === 0) return 'Nothing scheduled yet.'
  const days = new Set(cards.map((card) => card.slot_day)).size
  const spare = cards.filter((card) => (CAROUSEL_SLOTS as readonly string[]).includes(card.slot_time)).length
  const main = `${cards.length} reels over ${days} day${days === 1 ? '' : 's'} — ` +
    `${SLOTS.join(', ')} each day, never two inside an hour.`
  return spare
    ? `${main} ${spare} sit${spare === 1 ? 's' : ''} in the in-between slots, above three a day.`
    : main
}
