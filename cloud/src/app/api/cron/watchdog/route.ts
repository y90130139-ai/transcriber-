import { NextResponse } from 'next/server'
import { isScheduler } from '@/lib/cron'
import { sql } from '@/lib/db'

/**
 * The scrape watchdog (Geno, 2026-10-09): reads the run tables from the
 * OUTSIDE and pings Discord if the daily ingest is not taking place.
 *
 * The worker reports its own failures; this covers the case the worker cannot
 * — dead container, paused service, a loop that never came back — by noticing
 * that no run has landed in longer than a pass cycle should take. The message
 * names the exact state: how old the last run is, what the last status was,
 * and the error text when there is one.
 *
 * Point a schedule at it (every 3–6h is plenty):
 *   GET /api/cron/watchdog?k=$CRON_SECRET
 */

const OFMPRO_STALE_HOURS = 30   // the daily pull; the 6h loop only mirrors between them
const IG_STALE_HOURS = 30       // the daily read, with slack

const fmt = (stamp: unknown): string =>
  stamp ? new Date(String(stamp)).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : 'never'

const ageHours = (stamp: unknown): number | null =>
  stamp ? (Date.now() - Date.parse(String(stamp))) / 36e5 : null

export async function GET(request: Request) {
  if (!isScheduler(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [[ofmpro], [ig]] = await Promise.all([
    sql.query(
      `select started_at, finished_at, status, error
         from transcriber.ofmpro_runs
        order by started_at desc
        limit 1`,
    ),
    sql.query(
      `select started_at, finished_at, sightings
         from transcriber.scout_runs
        order by started_at desc
        limit 1`,
    ),
  ])

  const problems: string[] = []

  const ofmproAge = ageHours(ofmpro?.started_at)
  if (!ofmpro) {
    problems.push('OFMPro: no run has ever been recorded.')
  } else if (ofmpro.status === 'failed') {
    problems.push(`OFMPro: last run FAILED at ${fmt(ofmpro.finished_at ?? ofmpro.started_at)} — ${String(ofmpro.error ?? 'no error text').slice(0, 400)}`)
  } else if (ofmproAge !== null && ofmproAge > OFMPRO_STALE_HOURS) {
    problems.push(`OFMPro: last run ${fmt(ofmpro.started_at)} — ${ofmproAge.toFixed(0)}h ago, expected daily. The ingest is not taking place.`)
  }

  const igAge = ageHours(ig?.started_at)
  if (!ig) {
    problems.push('Instagram: no sweep has ever been recorded.')
  } else if (igAge !== null && igAge > IG_STALE_HOURS) {
    problems.push(`Instagram: last sweep ${fmt(ig.started_at)} — ${igAge.toFixed(0)}h ago. The daily read is not taking place.`)
  }

  if (problems.length === 0) {
    return NextResponse.json({ ok: true, ofmpro_hours: ofmproAge, ig_hours: igAge })
  }

  const webhook = process.env.DISCORD_WEBHOOK
  const user = process.env.DISCORD_USER_ID
  if (!webhook) {
    return NextResponse.json({ ok: false, problems, note: 'DISCORD_WEBHOOK is not set' })
  }

  const content = [
    user ? `<@${user}> ` : '',
    '🚨 **Scrape watchdog — the ingest is not taking place**',
    ...problems.map((problem) => `• ${problem}`),
    `Checked ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`,
  ].join('\n')

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Transcriber watchdog', content }),
  }).catch(() => null)

  return NextResponse.json({ ok: false, problems })
}
