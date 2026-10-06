/**
 * Plan reminders: the Gosian bot nudging a model that her week still has
 * unfilmed cards (Geno, 2026-10-06: "it's essential that they get the thing
 * [done], and then they get pinged").
 *
 * Deliberately sparse — two chances a week, never more:
 *
 *   midweek    Wednesday 16:00–20:59 ET, if nothing is filmed yet
 *   lastcall   Saturday 11:00–19:59 ET, if anything is still unfilmed
 *
 * The midweek nudge only fires at zero filmed: someone two cards in is
 * working and a reminder would read as nagging. Saturday asks about whatever
 * is left, because Sunday ends the week. Once per plan per kind, recorded in
 * `plan_nudges` even on failure (the shout-outs rule: a repeated nudge is
 * worse than a lost one). What a "card to film" is matches her own page
 * header: not hers, not declined, not made-already.
 *
 * Pure like week-shape.ts — the database half lives in reminders-db.ts so
 * the tests run without one.
 */

const ZONE = 'America/New_York'

export const NUDGE_WINDOWS = {
  midweek: { weekday: 3, from: 16, to: 20 },
  lastcall: { weekday: 6, from: 11, to: 19 },
} as const

export type NudgeKind = keyof typeof NUDGE_WINDOWS

export type Nudge = {
  /** `<plan_id>:<kind>` — what the bot answers back with. */
  id: string
  kind: NudgeKind
  plan_id: string
  model_id: string
  model_name: string
  chat_id: string
  week_of: string
  filmed: number
  left: number
  total: number
}

/** Wall-clock parts of `now` in New York (same shape as shoutouts'). */
export function easternClock(now: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday))
  return { weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` }
}

/** Which nudge this instant belongs to, or null outside both windows. */
export function nudgeWindow(now: number): NudgeKind | null {
  const et = easternClock(now)
  for (const [kind, window] of Object.entries(NUDGE_WINDOWS)) {
    if (et.weekday === window.weekday && et.hour >= window.from && et.hour <= window.to) {
      return kind as NudgeKind
    }
  }
  return null
}

/** The counts her own page header shows: cards that are hers to film. */
export function nudgeCounts(
  items: readonly { mine: boolean; filmed: boolean; verdict: 'accepted' | 'declined' | 'open'; made_at: string | null }[],
) {
  const toFilm = items.filter((item) => !item.mine && item.verdict !== 'declined' && !item.made_at)
  const filmed = toFilm.filter((item) => item.filmed).length
  return { filmed, left: toFilm.length - filmed, total: toFilm.length }
}

/** Whether this plan deserves this nudge, given its counts. */
export function nudgeDue(kind: NudgeKind, counts: { filmed: number; left: number }): boolean {
  if (counts.left === 0) return false
  if (kind === 'midweek') return counts.filmed === 0
  return true
}

/** The ET Monday of the week `now` falls in. */
export function currentWeekOf(now: number): string {
  const et = easternClock(now)
  const monday = new Date(Date.parse(`${et.date}T00:00:00Z`))
  const back = (et.weekday + 6) % 7
  monday.setUTCDate(monday.getUTCDate() - back)
  return monday.toISOString().slice(0, 10)
}
