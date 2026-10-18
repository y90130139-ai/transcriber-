import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

/** Hours after which a quiet reader is treated as a dead session: the daily
 *  pass runs every day at 19:00, so over a day and a bit means it missed one. */
const STALE_HOURS = 26

/**
 * Is the burner still reading? Judged from what it last wrote, because a dead
 * session does not announce itself — it just stops producing rows. The daily
 * pass writes an account header per creator per day, and only a signed-in
 * browser gets one back, so the newest snapshot is the heartbeat.
 */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const [row] = await sql.query(
    `select max(seen_at) as last_snapshot,
            extract(epoch from (now() - max(seen_at))) / 3600 as hours
       from transcriber.creator_snapshots`,
  )
  const hours = row?.hours === null || row?.hours === undefined ? null : Number(row.hours)
  return NextResponse.json({
    last_snapshot: row?.last_snapshot ?? null,
    hours: hours === null ? null : Math.round(hours * 10) / 10,
    alive: hours !== null && hours <= STALE_HOURS,
    fix: 'Sign the burner in again on the Mac: ./bin/scout-login, then ./bin/scout --session',
  })
}
