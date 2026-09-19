import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { preview } from '@/lib/sql'
import { IN_HOT_WINDOW, IN_MONTH, IN_WEEK, IS_HOT, SCORING_COLUMNS, SCORING_CTE, SCORING_JOIN } from '@/lib/hot'
import { badgesFor, SIGNALS_COLUMNS, SIGNALS_JOIN, signalsFrom } from '@/lib/appeal'
import { tagsForMany } from '@/lib/tagging'
import { AXES } from '@/lib/taxonomy'

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
  ${preview('t.plain', 220, 't.on_screen_text')} as preview
`

const ORDERS: Record<string, string> = {
  recent: 't.upload_date desc nulls last, t.transcribed_at desc',
  added: 'j.created_at desc',
  hot: 'outperformance desc nulls last, t.upload_date desc',
  likes: 't.like_count desc nulls last',
}

export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  const creator = (url.searchParams.get('creator') ?? '').trim()
  const window = url.searchParams.get('window') // 'week' | '30' | '90' | null
  const onlyHot = url.searchParams.get('hot') === '1'
  const sort = ORDERS[url.searchParams.get('sort') ?? ''] ?? ORDERS.recent

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
  const where: string[] = [`j.status = 'done'`]

  if (query) {
    params.push(`%${query}%`)
    where.push(`(t.plain ilike $${params.length} or t.author ilike $${params.length}
                 or t.title ilike $${params.length} or t.caption ilike $${params.length}
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

  const rows = await sql.query(
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
  )

  // The multiplier stays on the row for anyone who wants the working; the
  // badges are what the grid actually reads out.
  const items: Record<string, unknown>[] = rows.map((row) => ({ ...row, badges: badgesFor(signalsFrom(row)) }))

  // How many the filter actually holds, as against how many came back. Without
  // this the grid could only ever report what it was handed, so a truncated
  // view looked exactly like a complete one — which is how 76 of 166 items sat
  // unreachable, and how the first audit read a creator at 19 items when she
  // had 60. Same `where` and same params as the query above; only the select
  // and the ordering differ.
  const [held] = await sql.query(
    `with ${SCORING_CTE}
     select count(*)::int as total
       from transcriber.jobs j
       join transcriber.transcripts t on t.job_id = j.id
       ${SCORING_JOIN}
      where ${where.join(' and ')}`,
    params,
  )

  // Work in progress is never filtered — the point of the queue is to see
  // everything that has not landed yet.
  const pending = await sql.query(
    `select ${COLUMNS}
       from transcriber.jobs j
       left join transcriber.transcripts t on t.job_id = j.id
      where j.status in ('queued', 'running', 'failed')
      order by (j.status = 'running') desc, j.created_at desc
      limit 60`,
  )

  const [counts] = await sql.query(
    // ::int matters. Postgres count() is a bigint and the driver hands bigints
    // back as strings, so the nav badge was doing "2" + "0" and rendering 20.
    `select count(*) filter (where status = 'queued')::int  as queued,
            count(*) filter (where status = 'running')::int as running,
            count(*) filter (where status = 'done')::int    as done,
            count(*) filter (where status = 'failed')::int  as failed
       from transcriber.jobs`,
  )

  const [ping] = await sql.query(
    `select media_url, extract(epoch from (now() - seen_at)) as age
       from transcriber.worker_pings where id = 1`,
  )
  const age = ping?.age === null || ping?.age === undefined ? null : Number(ping.age)

  const tags = await tagsForMany(items.map((item) => item.id as string))
  const withTags = items.map((item) => ({ ...item, tags: tags.get(item.id as string) ?? [] }))

  return NextResponse.json({
    items: withTags,
    total: Number(held?.total ?? withTags.length),
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
