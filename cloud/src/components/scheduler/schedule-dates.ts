/**
 * Calendar math for the Scheduler (Geno, 2026-10-15).
 *
 * Sunday-first month grid (ContentStudio shape), Monday-first week view,
 * UTC date strings only — the calendar and the Autoposter from/to filters
 * both ride YYYY-MM-DD, so this file only ever produces strings.
 */

export const WEEKDAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Sunday that opens the week containing `date` (UTC). */
export function sundayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = parts(iso)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysIso(start, index))
}

/** First day of the month that contains `iso`. */
export function monthStart(iso: string): string {
  const [y, m] = parts(iso)
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/** Last day of the month that contains `iso`. */
export function monthEnd(iso: string): string {
  const [y, m] = parts(iso)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/** Shift a YYYY-MM-DD by whole months, clamping to day 1 of the target. */
export function addMonthsIso(iso: string, n: number): string {
  const [y, m] = parts(iso)
  const date = new Date(Date.UTC(y, m - 1 + n, 1))
  return date.toISOString().slice(0, 10)
}

/**
 * Sunday-first month cells for the grid: leading/trailing days from the
 * neighbouring months so every row is a full week (35 or 42 cells).
 */
export function monthCells(iso: string): string[] {
  const start = monthStart(iso)
  const [y, m] = parts(start)
  const gridStart = sundayOf(new Date(Date.UTC(y, m - 1, 1)))
  const end = monthEnd(iso)
  const [ey, em, ed] = parts(end)
  const gridEnd = addDaysIso(sundayOf(new Date(Date.UTC(ey, em - 1, ed))), 6)
  const cells: string[] = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    cells.push(cursor)
    cursor = addDaysIso(cursor, 1)
  }
  while (cells.length < 35) {
    cells.push(addDaysIso(cells[cells.length - 1], 1))
  }
  while (cells.length % 7 !== 0) {
    cells.push(addDaysIso(cells[cells.length - 1], 1))
  }
  return cells
}

/** "October 2025" for the month title. */
export function niceMonth(iso: string): string {
  const [y, m] = parts(iso)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/** "12–18 Oct", collapsing across a month flip to "28 Sep – 4 Oct". */
export function niceRange(from: string, to: string): string {
  const [fy, fm, fd] = parts(from)
  const [, tm, td] = parts(to)
  if (fm === tm) return `${fd}–${td} ${MONTHS[fm - 1]}`
  return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]}`
}

/** "Mon 12 Oct" for a day head. */
export function niceDay(iso: string): string {
  const [y, m, d] = parts(iso)
  const date = new Date(Date.UTC(y, m - 1, d))
  return `${WEEKDAYS[(date.getUTCDay() + 6) % 7]} ${d} ${MONTHS[m - 1]}`
}

/** Day-of-month number for a cell label. */
export function dayNumber(iso: string): number {
  return parts(iso)[2]
}

/** Whether `iso` falls inside the month named by `anchor` (YYYY-MM-DD). */
export function inMonth(iso: string, anchor: string): boolean {
  const [ay, am] = parts(anchor)
  const [iy, im] = parts(iso)
  return ay === iy && am === im
}

/** Today in the browser's own calendar, for the highlight ring. */
export function todayIsoLocal(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Browser IANA timezone when available. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
