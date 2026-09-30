/**
 * Which days an account needs pulled next (pure; see job.ts for why).
 */
import { addDays, dayOf, startOfDay } from './days'

export const BACKFILL_DAYS = 120
const WINDOW_DAYS = 30
const RESETTLE_DAYS = 3

/** The window an account needs next, or null when it is current. */
export function nextWindow(a: { pulled_through: string | null; pulled_at: string | null }, today: string): { from: string; to: string } | null {
  if (!a.pulled_through) {
    const from = addDays(today, -BACKFILL_DAYS)
    return { from, to: minDay(addDays(from, WINDOW_DAYS - 1), today) }
  }
  const pulledToday = a.pulled_at && dayOf(Date.parse(a.pulled_at)) === today
  if (a.pulled_through >= today && pulledToday) return null
  const from = addDays(a.pulled_through, -RESETTLE_DAYS)
  return { from, to: minDay(addDays(from, WINDOW_DAYS - 1), today) }
}

/**
 * Can her numbers for `today - 1` be trusted? Only if this account was pulled
 * cleanly today (so yesterday had fully ended when it was read) and reached
 * yesterday. A failed pull leaves `pulled_through` where it was — often at a
 * partial yesterday from the run before — so it is not enough on its own.
 */
export function isCurrent(
  a: { pulled_through: string | null; pulled_at: string | null; pull_error: string | null; missing_since: string | null },
  today: string,
): boolean {
  if (a.missing_since || a.pull_error || !a.pulled_through || !a.pulled_at) return false
  return dayOf(Date.parse(a.pulled_at)) === today && a.pulled_through >= addDays(today, -1)
}

const minDay = (a: string, b: string) => (a < b ? a : b)

/** Where a window stops: the end of its last day, or now if that day is
 *  today — Infloww refuses an `endTime` in the future. */
export function windowEnd(to: string, now: number): number {
  return Math.min(startOfDay(addDays(to, 1)), now)
}

