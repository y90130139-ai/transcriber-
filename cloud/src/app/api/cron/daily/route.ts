import { NextResponse } from 'next/server'
import { previewBatch, writeBatch } from '@/lib/batch'
import { isScheduler, PLANNING_TZ, weekdayIn } from '@/lib/cron'
import { addDays, mondayOf, todayIn } from '@/lib/dates'
import { sql } from '@/lib/db'

export const maxDuration = 60

/**
 * The week's clock, kept off the Mac.
 *
 * Vercel's Hobby plan allows a small number of once-a-day crons, so one daily
 * call carries both standing jobs and decides by weekday which is due:
 *
 *   Saturday → start the watchlist sweep (open accounts, via Apify)
 *   Sunday   → draft every active model's week
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

  return NextResponse.json(did)
}

/** Ask our own sweep route to start, carrying the scheduler's credential. */
async function startSweep(request: Request) {
  const origin = new URL(request.url).origin
  const response = await fetch(`${origin}/api/scout/apify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
  })
  const body = await response.json().catch(() => ({}))
  return response.ok ? body : { error: body?.error ?? response.status }
}

/**
 * Tomorrow's Monday, exactly as `bin/autodraft` asks for it: on Sunday that is
 * next week, and `mondayOf` snaps any other day back to the week already
 * running, so a deferred run still builds the right week.
 */
async function draftNextWeek() {
  const weekOf = mondayOf(addDays(todayIn(PLANNING_TZ), 1))

  const batch = await previewBatch(weekOf)
  const picks = batch.rows
    .map((row) => ({ model_id: row.model_id, job_ids: row.picks.map((pick) => pick.job_id) }))
    .filter((row) => row.job_ids.length > 0)
  const result = await writeBatch(weekOf, picks)

  await sql.query(
    `insert into transcriber.scout_runs (id, started_at, notes)
     values ($1, now(), $2::jsonb)
     on conflict (id) do nothing`,
    [`autodraft-${weekOf}`, JSON.stringify({ kind: 'autodraft', via: 'cloud', week_of: weekOf, ...result })],
  )
  return { week_of: weekOf, ...result }
}
