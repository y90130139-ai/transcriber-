import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { VIEW_TRIES } from '@/lib/queue-state'
import { sql } from '@/lib/db'
import { preview } from '@/lib/sql'
import { IN_HOT_WINDOW, IN_MONTH, IN_WEEK, IS_HOT, SCORING_COLUMNS, SCORING_CTE, SCORING_JOIN } from '@/lib/hot'
import { badgesFor, SIGNALS_COLUMNS, SIGNALS_JOIN, signalsFrom } from '@/lib/appeal'
import { AXES } from '@/lib/taxonomy'
import { WARN_DAYS, daysLeft, isHers, onOpenCard } from '@/lib/expiry'

/** One page. Deliberately still 90 — the fix for the ceiling is paging, not a
 *  bigger number, because a bigger number puts the same wall further out. */
const PAGE_SIZE = 90

/** A safety valve on a single request, not a page size. The grid asks for the
 *  span it already has open so a poll cannot truncate what was loaded; this
 *  stops a hand-written query asking for the whole table in one go. Twenty
 *  pages is far past anything reachable by tapping "Load more". */
const MAX_LIMIT = PAGE_SIZE * 20
// The worker heartbeats while it polls; past this it is treated as offline.
const WORKER_STALE_SEC = 90

const COLUMNS = `
  j.id, j.kind, j.source, j.label, j.status, j.stage, j.error, j.created_at, j.transcribe,
  t.platform, t.author, t.author_name, t.title, t.webpage_url,
  t.duration_sec, t.language, t.speaker_count, t.word_count,
  t.upload_date, t.transcribed_at, t.folder, t.like_count, t.comment_count,
  t.confirmed_at, (t.thumbnail is not null) as has_thumb,
  t.has_speech, t.speech_ratio, t.speech_override,
  ${preview('t.plain', 220, 't.on_screen_text')} as preview,
  j.archived_at,
  -- Days before it leaves the library (lib/expiry.ts); null for a model's own.
  case when ${isHers('j', 't')} then null else ${daysLeft('j', 't')} end as expires_in,
  ${onOpenCard('j')} as on_open_card,
  -- The filtered total rides the same pass as the rows (2026-10-09): a second
  -- count query ran the scoring CTE again and paid another round trip for a
  -- number the window function already knows.
  (count(*) over ())::int as total_matched,
  -- Tags, in the same pass. Fetching them afterwards was a second round trip
  -- for bytes this query already had the ids for.
  coalesce((
    select json_agg(json_build_object('axis', g.axis, 'tag', g.tag, 'origin', g.origin, 'score', g.score)
                    order by g.axis, g.score desc nulls last)
      from transcriber.tags g
     where g.job_id = j.id
  ), '[]'::json) as tags
`

const ORDERS: Record<string, string> = {
  recent: 't.upload_date desc nulls last, t.transcribed_at desc',
  added: 'j.created_at desc',
  hot: 'outperformance desc nulls last, t.upload_date desc',
  likes: 't.like_count desc nulls last',
}

export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  const creator = (url.searchParams.get('creator') ?? '').trim()
  const window = url.searchParams.get('window') // 'week' | '30' | '90' | null
  const onlyHot = url.searchParams.get('hot') === '1'
  const sort = ORDERS[url.searchParams.get('sort') ?? ''] ?? ORDERS.added

  // Both are read off the query string, so both are validated rather than
  // interpolated. They are the only two numbers in this file that reach SQL.
  const whole = (value: string | null, fallback: number, low: number, high: number): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(Math.max(Math.trunc(parsed), low), high)
  }
  const offset = whole(url.searchParams.get('offset'), 0, 0, 1_000_000)
  const limit = whole(url.searchParams.get('limit'), PAGE_SIZE, 1, MAX_LIMIT)

  const params: unknown[] = []
  // Which shelf: the live library, the ones about to leave, or the archive.
  const shelf = url.searchParams.get('shelf')
  const where: string[] = [`j.status = 'done'`]
  if (shelf === 'archived') where.push('j.archived_at is not null')
  else where.push('j.archived_at is null')
  if (shelf === 'expiring') {
    where.push(`not ${isHers('j', 't')} and ${daysLeft('j', 't')} <= ${WARN_DAYS}`)
  }

  if (query) {
    params.push(`%${query}%`)
    // j.label is in the search too, so "german #41" or "mirror reward"
    // finds the playbook reference by the name the team gave it.
    where.push(`(t.plain ilike $${params.length} or t.author ilike $${params.length}
                  or t.author_name ilike $${params.length}
                  or t.title ilike $${params.length} or t.caption ilike $${params.length}
                  or j.label ilike $${params.length}
                  or j.source ilike $${params.length})`)
  }
  if (creator) {
    params.push(creator)
    where.push(`t.author = $${params.length}`)
  }
  for (const axis of AXES) {
    const chosen = (url.searchParams.get(axis) ?? '').split(',').filter(Boolean)
    if (chosen.length === 0) continue
    params.push(chosen)
    where.push(`exists (select 1 from transcriber.tags g
                         where g.job_id = j.id and g.axis = '${axis}'
                           and g.tag = any($${params.length}::text[]))`)
  }
  if (window === 'week') where.push(IN_WEEK)
  if (window === '30') where.push(IN_MONTH)
  if (window === '90') where.push(IN_HOT_WINDOW)
  if (onlyHot) where.push(IS_HOT)

  // Four independent reads, one wait (2026-10-09): the rows, the nav counts,
  // the queue, and the Mac's heartbeat have no order between them, and run
  // sequentially they cost four round trips of latency for one screen.
  const [rows, countRows, pending, pingRows] = await Promise.all([
    sql.query(
      `with ${SCORING_CTE}
       select ${COLUMNS}, ${SCORING_COLUMNS}, ${SIGNALS_COLUMNS}
         from transcriber.jobs j
         join transcriber.transcripts t on t.job_id = j.id
         ${SCORING_JOIN}
         ${SIGNALS_JOIN}
        where ${where.join(' and ')}
        order by ${sort}
        limit ${limit} offset ${offset}`,
      params,
    ),
    sql.query(
      // ::int matters. Postgres count() is a bigint and the driver hands
      // bigints back as strings, so the nav badge was doing "2" + "0" and
      // rendering 20.
      `select count(*) filter (where status = 'queued')::int  as queued,
              count(*) filter (where status = 'running')::int as running,
              count(*) filter (where status = 'done' and archived_at is null)::int as done,
              count(*) filter (where archived_at is not null)::int as archived,
              count(*) filter (where status = 'failed')::int  as failed,
              -- Of those, the ones the viewer still has (lib/queue-state.ts).
              count(*) filter (where status = 'failed'
                                 and error like 'could not download%'
                                 and source ~ '/(reels?|p)/[A-Za-z0-9_-]+'
                                 and coalesce(m.tries, 0) < ${VIEW_TRIES})::int as waiting
         from transcriber.jobs
         left join transcriber.job_media m on m.job_id = transcriber.jobs.id`,
    ),
    sql.query(
      // Work in progress is never filtered — the point of the queue is to see
      // everything that has not landed yet.
      // The viewer's tries ride along so the queue can tell a reel it is still
      // working on from one it gave up on (lib/queue-state.ts). In flight
      // first, so a long tail of failures can never push live work past the
      // limit.
      `select ${COLUMNS}, coalesce(m.tries, 0)::int as view_tries
         from transcriber.jobs j
         left join transcriber.transcripts t on t.job_id = j.id
         left join transcriber.job_media m on m.job_id = j.id
        where j.status in ('queued', 'running', 'failed')
        order by case j.status when 'running' then 0 when 'queued' then 1 else 2 end,
                 j.created_at desc
        limit 300`,
    ),
    sql.query(
      `select media_url, extract(epoch from (now() - seen_at)) as age
         from transcriber.worker_pings where id = 1`,
    ),
  ])

  // The multiplier stays on the row for anyone who wants the working; the
  // badges are what the grid actually reads out. Tags and the filtered total
  // rode the query itself.
  const items: Record<string, unknown>[] = rows.map((row) => ({
    ...row,
    tags: row.tags ?? [],
    badges: badgesFor(signalsFrom(row)),
  }))

  const [counts] = countRows
  const [ping] = pingRows
  const age = ping?.age === null || ping?.age === undefined ? null : Number(ping.age)

  return NextResponse.json({
    items,
    // How many the filter actually holds, as against how many came back. The
    // grid showed what it was handed and a truncated view looked complete —
    // the window count makes the two numbers agree in one pass.
    total: rows.length > 0 ? Number(rows[0].total_matched) : items.length,
    offset,
    pageSize: PAGE_SIZE,
    pending,
    counts,
    worker: {
      online: age !== null && age < WORKER_STALE_SEC,
      secondsAgo: age,
      video: Boolean(ping?.media_url) && age !== null && age < WORKER_STALE_SEC,
    },
  })
}
