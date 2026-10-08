import { timingSafeEqual } from 'node:crypto'

/** Constant-time compare that tolerates different lengths. */
export function secretMatches(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Vercel's scheduler, or someone who holds CRON_SECRET.
 *
 * A cron invocation carries `Authorization: Bearer $CRON_SECRET` when that
 * variable is set. The guard matters here because these routes spend money —
 * scheduler-only routes can start paid or scheduled work.
 */
export function isScheduler(request: Request): boolean {
  const header = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const query = new URL(request.url).searchParams.get('k')
  const secret = process.env.CRON_SECRET
  return secretMatches(header, secret) || secretMatches(query, secret)
}

/** Where the week is reckoned: the business's own clock, not the server's.
 *  The same zone `currentWeekOf` defaults to. */
export const PLANNING_TZ = 'America/New_York'

/** The weekday where the business lives, not where the server happens to run.
 *  0 = Sunday. */
export function weekdayIn(timezone = PLANNING_TZ, now = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}
