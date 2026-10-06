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
 *   Saturday → start the watchlist sweep (open accounts, via Apify)
 *   Sunday   → draft every active model's week
 *   Every day → archive library reels past 90 days (lib/expiry.ts)
 *
 * Both were launchd jobs on the Mac. They are the parts that must not miss a
 * week if the Mac is asleep or gone, and neither needs anything local: the
 * sweep runs on Apify's machines and the draft is pure database work.
 *
 * The Mac keeps the gated half of the sweep (`./bin/scout --only burner`),
 * which needs a residential address and a signed-in session.
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

  // Every day, not just the scheduled ones: this is the check that notices the
  // Mac has stopped. It returns immediately while the Mac is alive.
  did.fallback = await callSelf(request, '/api/worker/cloud')

  return NextResponse.json(did)
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
 * The paid sweep, now a *fallback* rather than the weekly habit.
 *
 * The Mac reads the whole watchlist through a real browser for nothing
 * (`bin/scout --only burner`, Saturdays). Firing Apify on the same morning
 * would pay ~$4 a week to fetch what has already been fetched, so this only
 * spends money when the free pass did not happen — the Mac asleep, gone, or
 * its session expired. Resilience was always the point of running this in the
 * cloud; paying for it every week never was.
 */
async function startSweep(request: Request) {
  const [recent] = await sql.query(
    `select max(started_at) as at
       from transcriber.scout_runs
      where started_at > now() - interval '3 days'
        and notes->>'kind' is distinct from 'autodraft'`,
  )
  if (recent?.at) {
    return { skipped: 'the Mac already swept', last_sweep: recent.at }
  }
  return callSelf(request, '/api/scout/apify')
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
