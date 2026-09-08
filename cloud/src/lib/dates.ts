/** Weeks, due dates and day names.
 *
 * Plans are weekly and every week starts on a Monday, so a plan is addressed by
 * the Monday it belongs to. Dates cross the wire as `YYYY-MM-DD` strings, never
 * as Date objects — the database column is a `date` with no time and no zone,
 * and turning it into a JS Date is how a plan ends up a day early in Hawaii.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const DAY_SHORT = DAY_NAMES.map((name) => name.slice(0, 3))

export const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Today where the model actually is, as `YYYY-MM-DD`. */
export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date())
  }
}

/** Calendar arithmetic on a plain date string, with no timezone anywhere near it. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** The Monday of whatever week `date` falls in. */
export function mondayOf(date: string): string {
  const weekday = dayOfWeek(date)
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
}

/** The Monday of the current week, in the model's own timezone. */
export function currentWeekOf(timezone = 'America/New_York'): string {
  return mondayOf(todayIn(timezone))
}

/** `8 September` — the register the plan page is written in. */
export function formatDate(date: string | null | undefined): string {
  if (!isDateString(date)) return '—'
  const [, month, day] = date.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]}`
}

/** `Mon 8 Sep`, for lines that need the weekday too. */
export function formatDay(date: string | null | undefined): string {
  if (!isDateString(date)) return '—'
  return `${DAY_SHORT[dayOfWeek(date)]} ${formatDate(date)}`
}

export function filmingDaysLabel(days: number[]): string {
  const clean = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort()
  if (clean.length === 0) return 'your call'
  return clean.map((day) => DAY_SHORT[day]).join(', ')
}

/** Past its due date, judged where she is rather than where the server is. */
export function isOverdue(due: string | null | undefined, timezone: string): boolean {
  return isDateString(due) && todayIn(timezone) > due
}
