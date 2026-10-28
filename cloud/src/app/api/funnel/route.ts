import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

/** The day's funnel reading, pushed up by the Mac after each scan.
 *
 *  The scan has to run there — Instagram refuses a logged-in session from a
 *  datacenter IP, and the burner has been trusted from one residential
 *  address for weeks. So the Mac is the eyes and this is the memory: it keeps
 *  nothing locally that matters, and the history that answers "do deep links
 *  die faster than a plain profile link" only exists once it is here.
 *
 *  Upsert on (handle, day), so a second scan on the same day corrects the
 *  first instead of appending. A reading whose state is absent is rejected
 *  rather than stored as a guess — "we could not read her bio" and "she has
 *  no link" are different answers and the whole system turns on the
 *  difference.
 */

const STATES = new Set(['green', 'amber', 'red', 'unknown'])

type Incoming = {
  handle?: unknown
  state?: unknown
  bio_funnel?: unknown
  bio_maybe?: unknown
  has_story?: unknown
  highlights?: unknown
  followers?: unknown
  is_private?: unknown
  creator?: unknown
  read_at?: unknown
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)

type Money = {
  creator?: unknown
  chat?: unknown
  tier?: unknown
  sep_full?: unknown
  oct_net?: unknown
  gap?: unknown
  week_now?: unknown
  week_peak?: unknown
}

/** The per-creator money summary, so the page can rank by what an action is
 *  worth. Optional: a scan that ran without a fresh Infloww sync still stores
 *  its reading rather than failing. */
async function storeMoney(day: string, incoming: Money[]): Promise<number> {
  const rows = incoming
    .filter((m) => str(m.creator))
    .map((m) => [
      str(m.creator), day, bool(m.chat), str(m.tier),
      num(m.sep_full), num(m.oct_net), num(m.gap), num(m.week_now), num(m.week_peak),
    ])
  if (!rows.length) return 0
  const values = rows
    .map((_, i) => {
      const b = i * 9
      return `($${b + 1},$${b + 2}::date,$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`
    })
    .join(',')
  await sql.query(
    `insert into transcriber.roster_money
       (creator, read_on, chat, tier, sep_full, oct_net, gap, week_now, week_peak)
     values ${values}
     on conflict (creator, read_on) do update set
       chat = excluded.chat, tier = excluded.tier, sep_full = excluded.sep_full,
       oct_net = excluded.oct_net, gap = excluded.gap,
       week_now = excluded.week_now, week_peak = excluded.week_peak`,
    rows.flat() as never[],
  )
  return rows.length
}

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { day?: unknown; records?: unknown; money?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 })
  }

  const day = str(body.day)
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 })
  }
  const incoming = Array.isArray(body.records) ? (body.records as Incoming[]) : null
  if (!incoming || !incoming.length) {
    return NextResponse.json({ error: 'records must be a non-empty array' }, { status: 400 })
  }

  const rows: unknown[][] = []
  const refused: string[] = []
  for (const r of incoming) {
    const handle = str(r.handle)
    const state = str(r.state)
    if (!handle || !state || !STATES.has(state)) {
      refused.push(handle ?? '(no handle)')
      continue
    }
    rows.push([
      handle, day, state,
      str(r.bio_funnel) ?? str(r.bio_maybe),
      bool(r.has_story), num(r.highlights), num(r.followers), bool(r.is_private),
      str(r.creator), str(r.read_at) ?? new Date().toISOString(),
    ])
  }
  if (!rows.length) return NextResponse.json({ error: 'nothing readable', refused }, { status: 400 })

  // One statement, so a half-written day cannot happen.
  const values = rows
    .map((_, i) => {
      const b = i * 10
      return `($${b + 1},$${b + 2}::date,$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10}::timestamptz)`
    })
    .join(',')
  await sql.query(
    `insert into transcriber.funnel_readings
       (handle, read_on, state, bio_url, has_story, highlights, followers,
        is_private, creator, read_at)
     values ${values}
     on conflict (handle, read_on) do update set
       state = excluded.state, bio_url = excluded.bio_url,
       has_story = excluded.has_story, highlights = excluded.highlights,
       followers = excluded.followers, is_private = excluded.is_private,
       creator = excluded.creator, read_at = excluded.read_at`,
    rows.flat() as never[],
  )

  const money = Array.isArray(body.money) ? await storeMoney(day, body.money as Money[]) : 0
  return NextResponse.json({ stored: rows.length, money, day, refused })
}
