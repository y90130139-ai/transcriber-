/** Carrying a past week forward.
 *
 * Her link shows one week — the nearest sent one — so videos left on a week
 * that has gone by are videos she cannot see. Carrying moves them onto the
 * week she is actually looking at. A move, never a copy: the item keeps its
 * id, so her thread, her accept or decline, filmed and posted, the R2 video
 * and the card number all come with it.
 *
 * Pure, and free of the database, so the editor's button and the route that
 * does the move pick the target week by the same rule.
 */

import { addDays } from './dates'

export type WeekRef = { id: string; week_of: string; status: 'draft' | 'sent' }

export type CarryTarget =
  | { kind: 'existing'; id: string; week_of: string }
  | { kind: 'new'; week_of: string }

/** A week is past once its Monday is before this week's Monday. */
export const isPastWeek = (weekOf: string, thisWeek: string): boolean => weekOf < thisWeek

/**
 * Where a past week's videos go.
 *
 * Only weeks that have not gone by are candidates. Among those, a sent one
 * wins over a draft, because the sent one is what her link shows; otherwise
 * the latest. With none at all, this week is created.
 */
export function carryTarget(weeks: readonly WeekRef[], sourceId: string, thisWeek: string): CarryTarget {
  const candidates = weeks
    .filter((week) => week.id !== sourceId && !isPastWeek(week.week_of, thisWeek))
    .sort((a, b) => b.week_of.localeCompare(a.week_of))
  const sent = candidates
    .filter((week) => week.status === 'sent')
    .sort((a, b) => a.week_of.localeCompare(b.week_of))
  const pick = sent[0] ?? candidates[0]
  return pick
    ? { kind: 'existing', id: pick.id, week_of: pick.week_of }
    : { kind: 'new', week_of: thisWeek }
}

/**
 * The week the editor opens on: the latest week from this one on that already
 * has videos — the one being planned. Late in a week, next week's plan is the
 * one with ten cards on it, and opening on this week's hid it. Falls back to
 * this week, then to whatever there is.
 */
export function openingWeek<T extends WeekRef & { items: number }>(weeks: readonly T[], thisWeek: string): T | null {
  const planned = weeks
    .filter((week) => week.items > 0 && !isPastWeek(week.week_of, thisWeek))
    .sort((a, b) => b.week_of.localeCompare(a.week_of))
  return planned[0] ?? weeks.find((week) => week.week_of === thisWeek) ?? weeks[0] ?? null
}

/**
 * Where a card goes when no week is named (Recreate from the profile, which
 * has no week open): the latest draft week from this one on. With none, the
 * Monday after the latest sent week from this one on — or this week if there
 * is nothing ahead at all — so a tap never lands on a plan she has already
 * opened, nor on a week behind the one her link shows.
 */
export function workingWeek(
  weeks: readonly WeekRef[],
  thisWeek: string,
): { kind: 'existing'; id: string; week_of: string } | { kind: 'new'; week_of: string } {
  const ahead = weeks
    .filter((week) => !isPastWeek(week.week_of, thisWeek))
    .sort((a, b) => b.week_of.localeCompare(a.week_of))
  const draft = ahead.find((week) => week.status === 'draft')
  if (draft) return { kind: 'existing', id: draft.id, week_of: draft.week_of }
  return { kind: 'new', week_of: ahead[0] ? addDays(ahead[0].week_of, 7) : thisWeek }
}
