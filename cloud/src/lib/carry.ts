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
