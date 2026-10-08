import { NextResponse } from 'next/server'
import { draftRoster } from '@/lib/draft'
import { isScheduler, PLANNING_TZ, weekdayIn } from '@/lib/cron'
import { addDays, mondayOf, todayIn } from '@/lib/dates'
import { sql } from '@/lib/db'
import { archiveExpired } from '@/lib/expiry'
import { ingestTrends } from '@/lib/trends'

export const maxDuration = 60

/**
 * The week's clock, kept off the Mac.
 *
 * Vercel's Hobby plan allows a small number of once-a-day crons, so one daily
 * call carries both standing jobs and decides by weekday which is due:
 *
 *   Sunday   → draft every active model's week
 *   Every day → archive library reels past 90 days (lib/expiry.ts)
 *
 * Both were launchd jobs on the Mac. They are the parts that must not miss a
 * week if the Mac is asleep or gone; the draft is pure database work.
 *
 * Signed-in Instagram reading belongs to the Railway worker (and the Mac
 * while it lasts); the Railway watchdog checks freshness every two hours.
 * The OPEN half of the sweep is Apify's again (restored 2026-10-08): the
 * ASAS migration deleted it before Railway scraping was validated, which
 * left one burner on one Mac as the entire intake with no fallback.
 */
export async function GET(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const force = new URL(request.url).searchParams.get('job')
  const day = weekdayIn()
  const did: Record<string, unknown> = { weekday: day }

  if (force === 'sweep' || (!force && day === 6)) {
    did.sweep = await startSweep(request)
  }

  if (force === 'autodraft' || (!force && day === 0)) {
    did.autodraft = await draftNextWeek()
  }

  // Every day: reels past 90 days leave the library, unless a model's own or
  // on a card still open. A failure here must not cost the fallback check.
  try {
    did.expired = await archiveExpired()
  } catch (error) {
    did.expired = { error: error instanceof Error ? error.message : String(error) }
  }

  // Every day: today's Google search trends into the Trends tab's table.
  // Free and keyless; a bad feed day must not cost the fallback check either.
  try {
    did.trends = await ingestTrends()
  } catch (error) {
    did.trends = { error: error instanceof Error ? error.message : String(error) }
  }

  // Keep the existing serverless queue fallback armed; Railway invokes the
  // same route more frequently so work does not depend on the daily cron.
  did.fallback = await callSelf(request, '/api/worker/cloud')

  return NextResponse.json(did)
}

/**
 * The paid sweep, a *fallback* rather than the weekly habit. Any reader —
 * the Mac's Friday chain, or Railway once its scraping is validated — that
 * wrote `scout_runs` in the last 3 days stands it down; otherwise Apify
 * fetches the open accounts so plays data never silently ages out.
 */
async function startSweep(request: Request) {
  const [recent] = await sql.query(
    `select max(started_at) as at
       from transcriber.scout_runs
      where started_at > now() - interval '3 days'
        and notes->>'kind' is distinct from 'autodraft'`,
  )
  if (recent?.at) {
    return { skipped: 'a reader already swept', last_sweep: recent.at }
  }
  return callSelf(request, '/api/scout/apify')
}

/** Call one of our own routes, carrying the scheduler's credential. */
async function callSelf(request: Request, path: string) {
  const origin = new URL(request.url).origin
  try {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    })
    const body = await response.json().catch(() => ({}))
    return response.ok ? body : { error: body?.error ?? response.status }
  } catch (error) {
    return { error: String(error).slice(0, 160) }
  }
}

/**
 * Tomorrow's Monday, exactly as `bin/autodraft` asks for it: on Sunday that is
 * next week, and `mondayOf` snaps any other day back to the week already
 * running, so a deferred run still builds the right week.
 */
async function draftNextWeek() {
  const weekOf = mondayOf(addDays(todayIn(PLANNING_TZ), 1))

  // The 70/20/10 split: reskins of her own winners, iterations, and the
  // library as the 10% — not the whole week, as the old batch drafted it.
  const result = await draftRoster(weekOf)

  await sql.query(
    `insert into transcriber.scout_runs (id, started_at, notes)
     values ($1, now(), $2::jsonb)
     on conflict (id) do nothing`,
    [`autodraft-${weekOf}`, JSON.stringify({ kind: 'autodraft', via: 'cloud', week_of: weekOf, ...result })],
  )
  return { week_of: weekOf, ...result }
}
