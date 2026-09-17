/** Standing: how she is responding to her plans, and who gets attention first.
 *
 * Two things, deliberately kept apart:
 *
 *  - **Heat** is automatic. It reads her last few *sent* weeks and says 🔥, 🧊,
 *    steady, or too new to tell. It moves every week and nobody sets it.
 *  - **Priority** (S/A/B/C) is Geno's. This file only *suggests* one, from her
 *    revenue band crossed with her engagement. A letter that silently changed
 *    every Monday would stop meaning anything.
 *
 * Rules that run through all of it, inherited from the sweep:
 *
 *  1. Only sent weeks count. A draft is invisible to her, so a week we never
 *     sent is our failure, never hers — and on the day this was written 17 of
 *     20 creators had never been sent one.
 *  2. A reasoned decline is engagement, not failure. It is taken out of what
 *     she was expected to film, and it counts as an answer.
 *  3. Nothing is a verdict without its reason. Every heat carries the line
 *     that produced it.
 *
 * Pure, with no database, so it is testable on the real shapes.
 */

/** Weeks read, newest first. A month is long enough to be a habit. */
export const WINDOW_WEEKS = 4
/** Newest week counts most. Renormalised over however many weeks exist. */
const RECENCY = [0.4, 0.3, 0.2, 0.1]
/** Under two sent weeks there is no pattern to read, only an anecdote. */
export const MIN_WEEKS = 2

const WEIGHTS = { filmed: 35, answered: 20, posted: 20, opened: 15, talked: 10 }

export const FIRE_AT = 75
export const COLD_BELOW = 25
/** A sent week unopened this long is cold regardless of history. */
export const UNOPENED_COLD_DAYS = 3

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type SentWeek = {
  week_of: string
  sent_at: string
  opened_at: string | null
  items: number
  accepted: number
  declined: number
  filmed: number
  posted: number
  /** Messages she wrote on this week's cards. */
  messages: number
}

export type Heat = 'fire' | 'cold' | 'steady' | 'new'

export type Engagement = {
  /** 0–100 over the window, or null when there is nothing sent to read. */
  score: number | null
  heat: Heat
  /** The one line that explains the heat. */
  why: string
  weeks: number
  /** The newest sent week was cleared: everything she did not decline, filmed. */
  cleared: boolean
  /** Per-part averages, 0–1, for the breakdown in her sheet. */
  parts: { filmed: number; answered: number; posted: number; opened: number; talked: number } | null
}

const ratio = (part: number, whole: number) => (whole > 0 ? Math.min(1, part / whole) : 0)

/** What she was actually asked to film: the week, minus what she turned down. */
const expected = (week: SentWeek) => Math.max(0, week.items - week.declined)

/** Cleared means nothing left undone. A week of only declines is not a clear. */
export const isCleared = (week: SentWeek): boolean =>
  week.items > 0 && expected(week) > 0 && week.filmed >= expected(week)

/** Opening fast is a signal; opening at all is most of it. */
function openedPart(week: SentWeek): number {
  if (!week.opened_at) return 0
  const hours = (Date.parse(week.opened_at) - Date.parse(week.sent_at)) / HOUR
  if (hours <= 24) return 1
  if (hours <= 72) return 0.6
  return 0.3
}

function partsOf(week: SentWeek, postingTracked: boolean) {
  return {
    filmed: ratio(week.filmed, expected(week)),
    answered: ratio(week.accepted + week.declined, week.items),
    // Posting is bound by hand in the console. Until any of hers has been, a
    // zero here says nothing about her, so it is left out rather than counted.
    posted: postingTracked ? ratio(week.posted, expected(week)) : 0,
    opened: openedPart(week),
    talked: week.messages > 0 ? 1 : 0,
  }
}

/**
 * Her engagement over her newest sent weeks.
 *
 * `now` is passed in so the unopened rule can be tested. `postingTracked` is
 * whether any post of hers has ever been bound; while it is false, the posted
 * weight moves onto filmed.
 */
export function engagementOf(
  sentWeeks: readonly SentWeek[],
  now: number,
  postingTracked: boolean,
): Engagement {
  const weeks = [...sentWeeks]
    .filter((week) => week.items > 0)
    .sort((a, b) => b.week_of.localeCompare(a.week_of))
    .slice(0, WINDOW_WEEKS)

  if (weeks.length === 0) {
    return { score: null, heat: 'new', why: 'No sent week yet', weeks: 0, cleared: false, parts: null }
  }

  const weights = postingTracked
    ? WEIGHTS
    : { ...WEIGHTS, filmed: WEIGHTS.filmed + WEIGHTS.posted, posted: 0 }

  const recency = RECENCY.slice(0, weeks.length)
  const recencyTotal = recency.reduce((sum, value) => sum + value, 0)

  const blended = weeks.reduce(
    (acc, week, index) => {
      const share = recency[index] / recencyTotal
      const parts = partsOf(week, postingTracked)
      return {
        filmed: acc.filmed + parts.filmed * share,
        answered: acc.answered + parts.answered * share,
        posted: acc.posted + parts.posted * share,
        opened: acc.opened + parts.opened * share,
        talked: acc.talked + parts.talked * share,
      }
    },
    { filmed: 0, answered: 0, posted: 0, opened: 0, talked: 0 },
  )

  const score = Math.round(
    blended.filmed * weights.filmed +
    blended.answered * weights.answered +
    blended.posted * weights.posted +
    blended.opened * weights.opened +
    blended.talked * weights.talked,
  )

  const newest = weeks[0]
  const cleared = isCleared(newest)
  const daysSinceSent = (now - Date.parse(newest.sent_at)) / DAY
  const base = { score, weeks: weeks.length, cleared, parts: blended }

  // Order matters: a clear is the loudest fact, an unopened week the next.
  if (cleared) {
    return { ...base, heat: 'fire', why: `Cleared ${newest.filmed}/${expected(newest)} on her newest week` }
  }
  if (!newest.opened_at && daysSinceSent >= UNOPENED_COLD_DAYS) {
    return { ...base, heat: 'cold', why: `Newest week unopened for ${Math.floor(daysSinceSent)} days` }
  }
  if (weeks.length < MIN_WEEKS) {
    return { ...base, heat: 'new', why: 'One sent week — too early to read' }
  }
  if (score >= FIRE_AT) return { ...base, heat: 'fire', why: `Scoring ${score} over ${weeks.length} sent weeks` }
  if (score < COLD_BELOW) return { ...base, heat: 'cold', why: `Scoring ${score} over ${weeks.length} sent weeks` }
  return { ...base, heat: 'steady', why: `Scoring ${score} over ${weeks.length} sent weeks` }
}

export type Priority = 'S' | 'A' | 'B' | 'C'
export type RevenueBand = 'high' | 'mid' | 'low'
export type Situation = 'star' | 'at_risk' | 'rising' | 'steady' | 'dormant'

export type Suggestion = {
  priority: Priority
  situation: Situation
  why: string
} | { priority: null; situation: null; why: string }

export const SITUATION_LABEL: Record<Situation, string> = {
  star: 'Star — protect',
  at_risk: 'At risk — talk to her',
  rising: 'Rising — invest',
  steady: 'Steady',
  dormant: 'Dormant',
}

/** Engaged, disengaged, or in between. Heat decides the ends; the score the middle. */
function drive(engagement: Engagement): 'high' | 'low' | 'mid' {
  if (engagement.heat === 'fire') return 'high'
  if (engagement.heat === 'cold') return 'low'
  if (engagement.score !== null && engagement.score >= 60) return 'high'
  if (engagement.score !== null && engagement.score < 35) return 'low'
  return 'mid'
}

/**
 * The priority the console would give her. Revenue × engagement, read as a
 * situation, because the two axes disagree often enough that one merged number
 * hides the case that matters most: high revenue masking a creator who has
 * stopped using the plan.
 */
export function suggestPriority(revenue: RevenueBand | null, engagement: Engagement): Suggestion {
  if (!revenue) return { priority: null, situation: null, why: 'Set her revenue band to get a suggestion' }
  if (engagement.heat === 'new' && !engagement.cleared) {
    return { priority: null, situation: null, why: 'Not enough sent weeks to judge yet' }
  }
  const effort = drive(engagement)
  const table: Record<RevenueBand, Record<'high' | 'mid' | 'low', [Priority, Situation]>> = {
    high: { high: ['S', 'star'], mid: ['A', 'steady'], low: ['A', 'at_risk'] },
    mid: { high: ['A', 'rising'], mid: ['B', 'steady'], low: ['C', 'dormant'] },
    low: { high: ['B', 'rising'], mid: ['C', 'steady'], low: ['C', 'dormant'] },
  }
  const [priority, situation] = table[revenue][effort]
  return { priority, situation, why: `${revenue} revenue · ${engagement.why.toLowerCase()}` }
}

export const HEAT_MARK: Record<Heat, string> = { fire: '🔥', cold: '🧊', steady: '', new: '' }
