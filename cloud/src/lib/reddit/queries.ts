/**
 * The read half: everything the nine pages ask for, answered from cached
 * database aggregates. No page ever calls Reddit, and no read waits on a
 * collection — the UI reads whatever the last run wrote and says when that
 * was.
 */

import { q, sql } from '../db'
import { getSettings } from './settings'
import { REGISTRY_CATEGORIES, TOPIC_CATEGORIES } from './registry'
import { latestRateState, queueState, registryCounts, usageSummary, usageToday } from './store'
import type { AlertRow, CollectorRun, Priority, RequirementRow, RequirementSource, SubredditRow, TrendStatus } from './types'

export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | 'custom'

/** The section's scope: adult communities only.
 *  Cached for 30 seconds so one page load does not read settings a dozen
 *  times. Every read path asks this. */
let scopeCache: { value: boolean; at: number } | null = null
export async function adultScope(): Promise<boolean> {
  if (scopeCache && Date.now() - scopeCache.at < 30_000) return scopeCache.value
  const settings = await getSettings()
  scopeCache = { value: settings.adult_only, at: Date.now() }
  return settings.adult_only
}

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1h', label: '1 hour' },
  { key: '6h', label: '6 hours' },
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'custom', label: 'Custom' },
]

export type RangeWindow = { from: Date; to: Date; hours: number; bucket: 'hour' | 'day'; key: RangeKey }

/** Resolve a range choice (or a custom span) into concrete window bounds. */
export function rangeWindow(range: RangeKey, from?: string | null, to?: string | null): RangeWindow {
  const now = new Date()
  const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720, '90d': 2160 } as const
  if (range !== 'custom') {
    const span = hours[range]
    return {
      from: new Date(now.getTime() - span * 3_600_000),
      to: now,
      hours: span,
      bucket: span <= 48 ? 'hour' : 'day',
      key: range,
    }
  }
  const toDate = to ? new Date(to) : now
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 168 * 3_600_000)
  const span = Math.max(1, (toDate.getTime() - fromDate.getTime()) / 3_600_000)
  return { from: fromDate, to: toDate, hours: span, bucket: span <= 48 ? 'hour' : 'day', key: 'custom' }
}

export function cleanRange(value: string | null | undefined): RangeKey {
  const keys: RangeKey[] = ['1h', '6h', '24h', '7d', '30d', '90d', 'custom']
  return keys.includes(value as RangeKey) ? (value as RangeKey) : '24h'
}

/* ------------------------------------------------------------- overview */

export type OverviewCard = {
  key: string
  label: string
  value: number | null
  note: string | null
  /** observed | calculated | estimate — the brief's labelling rule. */
  basis: 'observed' | 'calculated' | 'estimate'
}

export type SeriesPoint = { bucket: string; interest: number | null; activity: number; engagement: number }

export type OverviewTopic = {
  id: string
  name: string
  category: string
  creator: boolean
  interest: number | null
  growth: number | null
  mentions: number
  unique_authors: number
  velocity: number | null
  status: TrendStatus
  subreddits: number
  subscriber_context: number | null
  captured_at: string | null
  spark: number[]
}

export type OverviewPost = {
  id: string
  title: string
  subreddit: string
  score: number | null
  comments: number | null
  velocity: number | null
  created_utc: string
  permalink: string | null
  over18: boolean
}

export type OverviewFilters = { category?: string | null; subreddit?: string | null }

export type OverviewData = {
  range: RangeKey
  from: string
  to: string
  last_updated: string | null
  filters: OverviewFilters
  cards: OverviewCard[]
  series: SeriesPoint[]
  previous: { bucket: string; activity: number }[]
  has_previous: boolean
  trending: OverviewTopic[]
  rising: OverviewTopic[]
  top_posts: OverviewPost[]
  collector: {
    last_run_at: string | null
    last_run_state: string | null
    queued: number
    errors_24h: number
    success_rate: number | null
    api_remaining: number | null
    next_scan_at: string | null
    requests_today: number
    daily_cap: number
  }
  alerts: AlertRow[]
  building_baseline: boolean
}

export async function overviewData(
  range: RangeKey,
  from?: string | null,
  to?: string | null,
  filters: OverviewFilters = {},
): Promise<OverviewData> {
  const window = rangeWindow(range, from, to)
  const bucketFormat = window.bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00' : 'YYYY-MM-DD'
  const prevFrom = new Date(window.from.getTime() - (window.to.getTime() - window.from.getTime()))
  const clean: OverviewFilters = {
    category: filters.category?.trim() || null,
    subreddit: filters.subreddit?.trim().replace(/^r\//i, '').toLowerCase() || null,
  }

  const [cards, seriesRows, prevRows, trending, rising, topPosts, collector, alerts, lastSnapshot] = await Promise.all([
    overviewCards(window),
    bucketSeries(window, bucketFormat, window.from, window.to, clean),
    bucketSeries(window, bucketFormat, prevFrom, window.from, clean),
    topicRows({ sort: 'interest', limit: 6 }),
    topicRows({ sort: 'growth', limit: 4 }),
    postRows({ sort: 'velocity', limit: 5, window, subreddit: clean.subreddit, topicCategory: clean.category }),
    collectorSummary(),
    alertsList(5),
    lastTopicTimestamp(),
  ])

  return {
    range: window.key,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    last_updated: lastSnapshot,
    filters: clean,
    cards,
    series: seriesRows,
    previous: prevRows.map((row) => ({ bucket: row.bucket, activity: row.activity })),
    has_previous: prevRows.some((row) => row.activity > 0 || row.interest !== null),
    trending,
    rising,
    top_posts: topPosts,
    collector,
    alerts,
    building_baseline: seriesRows.filter((row) => row.interest !== null).length < 2,
  }
}

async function overviewCards(window: RangeWindow): Promise<OverviewCard[]> {
  const since = window.from.toISOString()
  const adultOnly = await adultScope()
  const inScope = `exists (select 1 from reddit.tracked_subreddits ts where ts.id = p.subreddit and (not $1::boolean or ts.adult))`
  const [subs, posts, todayPosts, engagement, topics, runs, topicActive] = await Promise.all([
    q<{ tracked: number; enabled: number; adult: number }>(
      `select count(*)::int as tracked,
              count(*) filter (where enabled and not paused)::int as enabled,
              count(*) filter (where adult)::int as adult
         from reddit.tracked_subreddits
        where (not $1::boolean or adult)`,
      [adultOnly],
    ),
    q<{ total: number }>(
      `select count(*)::int as total from reddit.reddit_posts p
        where p.is_deleted = false and ${inScope}`,
      [adultOnly],
    ),
    q<{ n: number }>(
      `select count(*)::int as n from reddit.reddit_posts p
        where p.is_deleted = false and ${inScope}
          and p.first_seen_at >= now() - interval '24 hours'`,
      [adultOnly],
    ),
    q<{ comments: string; engagement: string }>(
      `select coalesce(sum(p.comments), 0)::bigint as comments,
              coalesce(sum(coalesce(p.score,0) + coalesce(p.comments,0)), 0)::bigint as engagement
         from reddit.reddit_posts p where p.is_deleted = false and ${inScope}`,
      [adultOnly],
    ),
    q<{ active: number; breakout: number; rising: number }>(
      `with latest as (
         select distinct on (s.topic_id) s.topic_id, s.status
           from reddit.topic_metric_snapshots s
           join reddit.topic_entities t on t.id = s.topic_id and t.adult
          where s.captured_at >= $1::timestamptz and s.window_hours = 24
          order by s.topic_id, s.captured_at desc
       )
       select count(*)::int as active,
              count(*) filter (where status = 'breakout')::int as breakout,
              count(*) filter (where status = 'rising')::int as rising
         from latest`,
      [since],
    ),
    q<{ total: number; ok: number }>(
      `select count(*)::int as total, count(*) filter (where state in ('done'))::int as ok
         from reddit.collector_runs
        where started_at >= now() - interval '7 days'`,
    ),
    q<{ mentions: string }>(
      `select coalesce(sum(s.mentions), 0)::bigint as mentions from reddit.topic_metric_snapshots s
        join reddit.topic_entities t on t.id = s.topic_id and t.adult
       where s.captured_at >= $1::timestamptz and s.window_hours = 24`,
      [since],
    ),
  ])

  const runRow = runs[0] ?? { total: 0, ok: 0 }
  const engagementRow = engagement[0]
  return [
    { key: 'subreddits', label: 'Tracked subreddits', value: Number(subs[0]?.enabled ?? 0), note: `${subs[0]?.tracked ?? 0} seeded · ${subs[0]?.adult ?? 0} adult`, basis: 'observed' },
    { key: 'posts', label: 'Collected posts', value: Number(posts[0]?.total ?? 0), note: 'all time, deduplicated by Reddit id', basis: 'observed' },
    { key: 'new_posts', label: 'New posts today', value: Number(todayPosts[0]?.n ?? 0), note: 'first seen in the last 24 hours', basis: 'observed' },
    { key: 'comments', label: 'Comments collected', value: Number(engagementRow?.comments ?? 0), note: 'comment counts as reported by Reddit', basis: 'observed' },
    { key: 'engagement', label: 'Estimated engagement', value: Number(engagementRow?.engagement ?? 0), note: 'score + comments observed on collected posts — not impressions', basis: 'estimate' },
    { key: 'active_topics', label: 'Active topics', value: Number(topics[0]?.active ?? 0), note: `${Number(topicActive[0]?.mentions ?? 0)} mentions in this window`, basis: 'calculated' },
    { key: 'trending_topics', label: 'Trending topics', value: Number((topics[0]?.breakout ?? 0) + (topics[0]?.rising ?? 0)), note: `${topics[0]?.breakout ?? 0} breakout · ${topics[0]?.rising ?? 0} rising`, basis: 'calculated' },
    { key: 'success_rate', label: 'Collection success rate', value: runRow.total ? Math.round((runRow.ok / runRow.total) * 100) : null, note: runRow.total ? `${runRow.ok} of ${runRow.total} runs in 7 days` : 'no runs yet', basis: 'calculated' },
  ]
}

async function bucketSeries(
  window: RangeWindow,
  bucketFormat: string,
  from: Date,
  to: Date,
  filters: OverviewFilters = {},
): Promise<SeriesPoint[]> {
  const [interestRows, activityRows] = await Promise.all([
    q<{ bucket: string; interest: number | null }>(
      `select to_char(date_trunc($1, s.captured_at at time zone 'UTC'), $2) as bucket,
              avg(s.interest)::real as interest
         from reddit.topic_metric_snapshots s
         join reddit.topic_entities t on t.id = s.topic_id and t.adult
        where s.captured_at >= $3::timestamptz and s.captured_at <= $4::timestamptz and s.window_hours = 24
          and ($5::text is null or t.category = $5)
          and ($6::text is null or exists (
                select 1 from reddit.topic_mentions m
                 where m.topic_id = s.topic_id and m.subreddit = $6))
        group by 1 order by 1`,
      [window.bucket, bucketFormat, from.toISOString(), to.toISOString(), filters.category ?? null, filters.subreddit ?? null],
    ),
    // Activity is *mentions discovered per bucket* — the line actually
    // moves as collection finds new posts, unlike a per-run snapshot sum
    // that is a single spike then near-zero.
    q<{ bucket: string; activity: string; engagement: string }>(
      `select to_char(date_trunc($1, m.mentioned_at at time zone 'UTC'), $2) as bucket,
              count(*)::bigint as activity,
              count(distinct m.post_id)::bigint as engagement
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $7::boolean or ts.adult)
          join reddit.topic_entities t on t.id = m.topic_id and t.adult
        where m.mentioned_at >= $3::timestamptz and m.mentioned_at <= $4::timestamptz
          and ($5::text is null or m.subreddit = $5)
          and ($6::text is null or t.category = $6)
        group by 1 order by 1`,
      [window.bucket, bucketFormat, from.toISOString(), to.toISOString(), filters.subreddit ?? null, filters.category ?? null, await adultScope()],
    ),
  ])
  const buckets = bucketKeys(from, to, window.bucket, bucketFormat)
  const interest = new Map(interestRows.map((row) => [row.bucket, row.interest === null ? null : Number(row.interest)]))
  const activity = new Map(activityRows.map((row) => [row.bucket, { activity: Number(row.activity), engagement: Number(row.engagement) }]))
  return buckets.map((bucket) => ({
    bucket,
    interest: interest.get(bucket) ?? null,
    activity: activity.get(bucket)?.activity ?? 0,
    engagement: activity.get(bucket)?.engagement ?? 0,
  }))
}

/** The bucket keys a range should render, matching to_char's output. */
export function bucketKeys(from: Date, to: Date, bucket: 'hour' | 'day', format: string): string[] {
  const keys: string[] = []
  const step = bucket === 'hour' ? 3_600_000 : 86_400_000
  const cursor = new Date(Math.floor(from.getTime() / step) * step)
  const end = to.getTime()
  let guard = 0
  while (cursor.getTime() <= end && guard < 4000) {
    keys.push(formatBucket(cursor, format))
    cursor.setTime(cursor.getTime() + step)
    guard += 1
  }
  return keys
}

function formatBucket(date: Date, format: string): string {
  const iso = date.toISOString()
  if (format === 'YYYY-MM-DD') return iso.slice(0, 10)
  return `${iso.slice(0, 13)}:00`
}

async function collectorSummary(): Promise<OverviewData['collector']> {
  const settings = await getSettings()
  const [lastRun, queued, errors, usage, queue, requestsToday] = await Promise.all([
    q<{ started_at: string; state: string; remaining: number | null }>(
      `select started_at, state, remaining from reddit.collector_runs order by started_at desc limit 1`,
    ),
    q<{ n: number }>(
      `select count(*)::int as n from reddit.collector_jobs j
        where j.state = 'queued'
          and (not $1::boolean or exists (
                select 1 from reddit.tracked_subreddits ts where ts.id = j.subreddit and ts.adult))`,
      [settings.adult_only],
    ),
    q<{ n: number }>(`select count(*)::int as n from reddit.collector_runs where started_at >= now() - interval '24 hours' and errors > 0`),
    q<{ remaining: number | null }>(
      `select remaining from reddit.api_usage where remaining is not null order by at desc limit 1`,
    ),
    queueState(settings.adult_only),
    usageToday(),
  ])
  const [runs7] = await q<{ total: number; ok: number }>(
    `select count(*)::int as total, count(*) filter (where state = 'done')::int as ok
       from reddit.collector_runs where started_at >= now() - interval '7 days'`,
  )
  return {
    last_run_at: lastRun[0]?.started_at ?? null,
    last_run_state: lastRun[0]?.state ?? null,
    queued: Number(queued[0]?.n ?? 0),
    errors_24h: Number(errors[0]?.n ?? 0),
    success_rate: runs7 && runs7.total ? Math.round((runs7.ok / runs7.total) * 100) : null,
    api_remaining: usage[0]?.remaining ?? null,
    next_scan_at: queue.nextAt,
    requests_today: requestsToday,
    daily_cap: settings.daily_cap,
  }
}

async function lastTopicTimestamp(): Promise<string | null> {
  const [row] = await q<{ at: string | null }>(
    `select max(s.captured_at) as at from reddit.topic_metric_snapshots s
      join reddit.topic_entities t on t.id = s.topic_id and t.adult`,
  )
  return row?.at ?? null
}

/* ------------------------------------------------------- topic tables */

export type TopicQuery = {
  category?: string | null
  status?: string | null
  adult?: boolean
  creator?: boolean
  search?: string | null
  sort?: 'interest' | 'growth' | 'activity' | 'velocity' | 'freshness'
  limit?: number
  offset?: number
}

type TopicDbRow = {
  id: string
  name: string
  category: string
  adult: boolean
  creator: boolean
  mentions: number
  unique_authors: number
  subreddits: number
  engagement: string | number
  velocity: number | null
  growth: number | null
  interest: number | null
  breakout: number | null
  confidence: number | null
  status: TrendStatus
  captured_at: string
  top_subreddit: string | null
  subscriber_context: string | number | null
}

const TOPIC_LATEST = `
  with latest as (
    select distinct on (topic_id) *
      from reddit.topic_metric_snapshots
     where window_hours = 24
     order by topic_id, captured_at desc
  )
  select t.id, t.name, t.category, t.adult, t.creator,
         l.mentions, l.unique_authors, l.subreddits, l.engagement,
         l.velocity, l.growth, l.interest, l.breakout, l.confidence, l.status, l.captured_at,
         (select m.subreddit from reddit.topic_mentions m
           where m.topic_id = t.id group by m.subreddit order by count(*) desc limit 1) as top_subreddit,
         (select coalesce(sum(s.subscribers), 0)
            from (select distinct m.subreddit from reddit.topic_mentions m where m.topic_id = t.id) x
            join reddit.tracked_subreddits s on s.id = x.subreddit) as subscriber_context
    from reddit.topic_entities t
    join latest l on l.topic_id = t.id and t.adult`

const TOPIC_SORTS: Record<string, string> = {
  interest: 'interest desc nulls last',
  growth: 'growth desc nulls last',
  activity: 'mentions desc',
  velocity: 'velocity desc nulls last',
  freshness: 'captured_at desc',
}

export async function topicRows(query: TopicQuery = {}): Promise<OverviewTopic[]> {
  const conditions = [`category = any($1::text[])`]
  const params: unknown[] = [TOPIC_CATEGORIES]
  if (query.category) { params.push(query.category); conditions.push(`category = $${params.length}`) }
  if (query.status) { params.push(query.status); conditions.push(`status = $${params.length}`) }
  if (query.adult === false) conditions.push(`adult = false`)
  if (query.search) {
    params.push(`%${query.search.toLowerCase()}%`)
    conditions.push(`(lower(name) like $${params.length} or lower(id) like $${params.length})`)
  }
  const where = conditions.length ? ` where ${conditions.join(' and ')}` : ''
  const sort = TOPIC_SORTS[query.sort ?? 'interest'] ?? TOPIC_SORTS.interest
  params.push(Math.min(500, Math.max(1, query.limit ?? 100)))
  params.push(Math.max(0, query.offset ?? 0))
  const rows = await q<TopicDbRow>(
    `select * from (${TOPIC_LATEST}) base${where} order by ${sort} limit $${params.length - 1} offset $${params.length}`,
    params,
  )
  const sparks = await topicSparks(rows.map((row) => row.id))
  return rows.map((row) => toOverviewTopic(row, sparks.get(row.id) ?? []))
}

function toOverviewTopic(row: TopicDbRow, spark: number[]): OverviewTopic {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    creator: Boolean(row.creator),
    interest: row.interest === null ? null : Number(row.interest),
    growth: row.growth === null ? null : Number(row.growth),
    mentions: Number(row.mentions),
    unique_authors: Number(row.unique_authors),
    velocity: row.velocity === null ? null : Number(row.velocity),
    status: row.status,
    subreddits: Number(row.subreddits),
    subscriber_context: row.subscriber_context === null || row.subscriber_context === undefined
      ? null : Number(row.subscriber_context),
    captured_at: row.captured_at ?? null,
    spark,
  }
}

/** The last N interest readings per topic, oldest first — the table spark. */
export async function topicSparks(ids: string[], points = 12): Promise<Map<string, number[]>> {
  if (!ids.length) return new Map()
  const rows = await q<{ topic_id: string; interest: number; captured_at: string }>(
    `select topic_id, interest::real as interest, captured_at
       from (
         select topic_id, interest, captured_at,
                row_number() over (partition by topic_id order by captured_at desc) as rn
           from reddit.topic_metric_snapshots
          where topic_id = any($1::text[]) and interest is not null
       ) ranked
      where rn <= $2
      order by topic_id, captured_at`,
    [ids, points],
  )
  const map = new Map<string, number[]>()
  for (const row of rows) {
    const list = map.get(row.topic_id) ?? []
    list.push(Number(row.interest))
    map.set(row.topic_id, list)
  }
  return map
}

/* -------------------------------------------------------- topic detail */

export type TopicDetail = {
  topic: {
    id: string
    name: string
    category: string
    adult: boolean
    keywords: string[]
    source: string
    first_seen_at: string
  }
  latest: OverviewTopic & { engagement: number; confidence: number | null; breakout: number | null; unique_authors: number; captured_at: string | null }
  series: { bucket: string; interest: number | null; mentions: number }[]
  history: { mentions: number; authors: number; communities: number; engagement: number; velocity: number | null; growth: number | null; interest: number | null; status: TrendStatus; confidence: number | null; captured_at: string }[]
  posts: OverviewPost[]
  subreddits: { id: string; mentions: number; engagement: number }[]
  related: { id: string; name: string; category: string; interest: number | null }[]
}

export async function topicDetail(slug: string): Promise<TopicDetail | null> {
  const [entity] = await q<{ id: string; name: string; category: string; adult: boolean; creator: boolean; keywords: string[]; source: string; first_seen_at: string }>(
    `select id, name, category, adult, creator, keywords, source, first_seen_at from reddit.topic_entities
      where id = $1 and adult and category = any($2::text[])`,
    [slug, TOPIC_CATEGORIES],
  )
  if (!entity) return null
  const adultOnly = await adultScope()

  const [latestRows, history, posts, subs, related] = await Promise.all([
    q<TopicDbRow>(`${TOPIC_LATEST} where t.id = $1`, [slug]),
    q<{ captured_at: string; mentions: number; unique_authors: number; subreddits: number; engagement: string; velocity: number | null; growth: number | null; interest: number | null; status: TrendStatus; confidence: number | null }>(
      `select captured_at, mentions, unique_authors, subreddits, engagement, velocity, growth, interest, status, confidence
         from reddit.topic_metric_snapshots
        where topic_id = $1 and captured_at >= now() - interval '30 days'
        order by captured_at desc limit 120`,
      [slug],
    ),
    q<{ id: string; title: string; subreddit: string; score: number | null; comments: number | null; created_utc: string; permalink: string | null; over18: boolean; velocity: number | null }>(
      `select p.id, p.title, p.subreddit, p.score, p.comments, p.created_utc, p.permalink, p.over18
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $2::boolean or ts.adult)
        where m.topic_id = $1
        order by (coalesce(p.score,0) + coalesce(p.comments,0)) desc
        limit 10`,
      [slug, adultOnly],
    ),
    q<{ subreddit: string; mentions: number; engagement: string }>(
      `select m.subreddit, count(*)::int as mentions,
              coalesce(sum(coalesce(p.score,0) + coalesce(p.comments,0)), 0)::bigint as engagement
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $2::boolean or ts.adult)
        where m.topic_id = $1
        group by m.subreddit order by count(*) desc limit 8`,
      [slug, adultOnly],
    ),
    q<{ id: string; name: string; category: string; interest: number | null }>(
      `select t.id, t.name, t.category, l.interest::real as interest
         from (
           select distinct on (topic_id) topic_id, interest
             from reddit.topic_metric_snapshots
            where window_hours = 24
            order by topic_id, captured_at desc
         ) l
         join reddit.topic_entities t on t.id = l.topic_id
         where t.id <> $1 and t.category = $2 and t.adult
        order by l.interest desc nulls last
        limit 6`,
      [slug, entity.category],
    ),
  ])

  const row = latestRows[0]
  const spark = row ? (await topicSparks([row.id])).get(row.id) ?? [] : []
  const latest: TopicDetail['latest'] = row
    ? {
        ...toOverviewTopic(row, spark),
        engagement: Number(row.engagement),
        confidence: row.confidence === null ? null : Number(row.confidence),
        breakout: row.breakout === null ? null : Number(row.breakout),
        unique_authors: Number(row.unique_authors),
        captured_at: row.captured_at,
      }
    : {
        id: entity.id, name: entity.name, category: entity.category, creator: Boolean(entity.creator),
        interest: null, growth: null, mentions: 0, velocity: null, status: 'building', subreddits: 0,
        subscriber_context: null, spark: [],
        engagement: 0, confidence: null, breakout: null, unique_authors: 0, captured_at: null,
      }

  const byDay = new Map<string, { interest: number[]; mentions: number }>()
  for (const point of history) {
    // Neon hands timestamptz back as a Date; `.slice` on it is a runtime
    // error TS never sees through the typed query cast. Normalise first.
    const day = new Date(point.captured_at).toISOString().slice(0, 10)
    const entry = byDay.get(day) ?? { interest: [], mentions: 0 }
    if (point.interest !== null) entry.interest.push(Number(point.interest))
    entry.mentions += Number(point.mentions)
    byDay.set(day, entry)
  }

  return {
    topic: entity,
    latest,
    series: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, entry]) => ({
        bucket,
        interest: entry.interest.length ? Math.round((entry.interest.reduce((t, v) => t + v, 0) / entry.interest.length) * 10) / 10 : null,
        mentions: entry.mentions,
      })),
    history: history.map((point) => ({
      mentions: Number(point.mentions),
      authors: Number(point.unique_authors),
      communities: Number(point.subreddits),
      engagement: Number(point.engagement),
      velocity: point.velocity === null ? null : Number(point.velocity),
      growth: point.growth === null ? null : Number(point.growth),
      interest: point.interest === null ? null : Number(point.interest),
      status: point.status,
      confidence: point.confidence === null ? null : Number(point.confidence),
      captured_at: point.captured_at,
    })),
    posts,
    subreddits: subs.map((sub) => ({ id: sub.subreddit, mentions: Number(sub.mentions), engagement: Number(sub.engagement) })),
    related,
  }
}

/* --------------------------------------------------------------- posts */

export type PostQuery = {
  subreddit?: string | null
  category?: string | null
  topicCategory?: string | null
  listing?: string | null
  search?: string | null
  over18?: boolean | null
  sort?: 'velocity' | 'score' | 'comments' | 'recent' | 'oldest'
  window?: RangeWindow
  limit?: number
  offset?: number
  /** Overrides the section scope (used by nothing today; kept explicit). */
  adultOnly?: boolean
}

export async function postRows(query: PostQuery): Promise<OverviewPost[]> {
  const conditions = [`p.is_deleted = false`]
  const params: unknown[] = []
  const adultOnly = query.adultOnly ?? await adultScope()
  if (adultOnly) conditions.push(`exists (select 1 from reddit.tracked_subreddits ts where ts.id = p.subreddit and ts.adult)`)
  if (query.subreddit) { params.push(query.subreddit); conditions.push(`p.subreddit = $${params.length}`) }
  if (query.listing) { params.push(query.listing); conditions.push(`p.listing = $${params.length}`) }
  if (query.search) { params.push(`%${query.search.toLowerCase()}%`); conditions.push(`lower(p.title) like $${params.length}`) }
  if (query.over18 === false) conditions.push(`p.over18 = false`)
  if (query.over18 === true) conditions.push(`p.over18 = true`)
  if (query.category) { params.push(query.category); conditions.push(`exists (select 1 from reddit.tracked_subreddits s where s.id = p.subreddit and s.category = $${params.length})`) }
  if (query.topicCategory) {
    params.push(query.topicCategory)
    conditions.push(`exists (
      select 1 from reddit.topic_mentions m
      join reddit.topic_entities t on t.id = m.topic_id and t.adult
      where m.post_id = p.id and t.category = $${params.length})`)
  }
  if (query.window) {
    params.push(query.window.from.toISOString())
    conditions.push(`p.created_utc >= $${params.length}::timestamptz`)
  }
  const sorts: Record<string, string> = {
    velocity: 'velocity desc nulls last',
    score: 'p.score desc nulls last',
    comments: 'p.comments desc nulls last',
    recent: 'p.created_utc desc',
    oldest: 'p.created_utc asc',
  }
  const sort = sorts[query.sort ?? 'velocity'] ?? sorts.velocity
  params.push(Math.min(200, Math.max(1, query.limit ?? 50)))
  params.push(Math.max(0, query.offset ?? 0))

  const rows = await q<{
    id: string; title: string; subreddit: string; score: number | null; comments: number | null;
    created_utc: string; permalink: string | null; over18: boolean; velocity: number | null
  }>(
    `with snaps as (
       select post_id, captured_at, score, comments,
              lag(score) over w as prev_score,
              lag(comments) over w as prev_comments,
              lag(captured_at) over w as prev_at
         from reddit.reddit_post_metric_snapshots
         window w as (partition by post_id order by captured_at)
     ), latest as (
       select distinct on (post_id) * from snaps order by post_id, captured_at desc
     )
     select p.id, p.title, p.subreddit, p.score, p.comments, p.created_utc, p.permalink, p.over18,
            case when l.prev_at is not null and extract(epoch from l.captured_at - l.prev_at) > 180
                 then greatest(0, coalesce(l.score,0) + coalesce(l.comments,0)
                               - coalesce(l.prev_score,0) - coalesce(l.prev_comments,0))
                      / (extract(epoch from l.captured_at - l.prev_at) / 3600)
                 else (coalesce(p.score,0) + coalesce(p.comments,0))
                      / greatest(1, extract(epoch from now() - p.created_utc) / 3600)
            end::real as velocity
       from reddit.reddit_posts p
       left join latest l on l.post_id = p.id
      where ${conditions.join(' and ')}
      order by ${sort}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  )
  return rows.map((row) => ({ ...row, velocity: row.velocity === null ? null : Math.round(Number(row.velocity) * 100) / 100 }))
}

export type PostDetail = {
  post: OverviewPost & {
    author: string | null
    url: string | null
    kind: string | null
    flair: string | null
    upvote_ratio: number | null
    first_seen_at: string
    selftext_len: number | null
    topics: { id: string; name: string }[]
  }
  snapshots: { captured_at: string; score: number | null; comments: number | null }[]
  related: OverviewPost[]
}

export async function postDetail(id: string): Promise<PostDetail | null> {
  const adultOnly = await adultScope()
  const [post] = await q<{
    id: string; title: string; subreddit: string; author: string | null; score: number | null; comments: number | null;
    created_utc: string; permalink: string | null; url: string | null; kind: string | null; flair: string | null;
    upvote_ratio: number | null; first_seen_at: string; selftext_len: number | null; over18: boolean
  }>(
    `select p.id, p.title, p.subreddit, p.author, p.score, p.comments, p.created_utc, p.permalink, p.url,
            p.kind, p.flair, p.upvote_ratio, p.first_seen_at, p.selftext_len, p.over18
       from reddit.reddit_posts p
      where p.id = $1 and p.is_deleted = false
        and (not $2::boolean or exists (
              select 1 from reddit.tracked_subreddits ts where ts.id = p.subreddit and ts.adult))`,
    [id, adultOnly],
  )
  if (!post) return null

  const [snapshots, topics, related] = await Promise.all([
    q<{ captured_at: string; score: number | null; comments: number | null }>(
      `select captured_at, score, comments from reddit.reddit_post_metric_snapshots
        where post_id = $1 order by captured_at limit 200`,
      [id],
    ),
    q<{ id: string; name: string }>(
      `select t.id, t.name from reddit.topic_mentions m join reddit.topic_entities t on t.id = m.topic_id and t.adult
        where m.post_id = $1 order by t.name`,
      [id],
    ),
    postRows({ subreddit: post.subreddit, sort: 'score', limit: 6 }),
  ])

  return {
    post: {
      ...post,
      velocity: null,
      topics,
    },
    snapshots,
    related: related.filter((row) => row.id !== id).slice(0, 5),
  }
}

/* ----------------------------------------------------------- subreddits */

export type SubredditDetail = {
  subreddit: SubredditRow
  series: { bucket: string; posts: number; engagement: number; subscribers: number | null }[]
  topics: { id: string; name: string; mentions: number }[]
  posts: OverviewPost[]
  errors: { at: string; error: string }[]
}

export async function subredditDetail(id: string): Promise<SubredditDetail | null> {
  const [row] = await q<{
    id: string; display_name: string; category: string; url: string | null; title: string | null;
    description: string | null; subscribers: string | number | null; over18: boolean; adult: boolean;
    enabled: boolean; paused: boolean; priority: Priority; interval_minutes: number; status: string;
    status_note: string | null; validated_at: string | null; last_synced_at: string | null;
    last_error: string | null; consecutive_failures: number; source: 'seed' | 'manual';
    posts_collected: number; engagement: number
  }>(
    `select s.*,
            (select count(*)::int from reddit.reddit_posts p where p.subreddit = s.id and p.is_deleted = false) as posts_collected,
            (select coalesce(sum(coalesce(p.score,0) + coalesce(p.comments,0)), 0)::bigint from reddit.reddit_posts p where p.subreddit = s.id and p.is_deleted = false) as engagement
        from reddit.tracked_subreddits s where s.id = $1 and s.adult and s.category = any($2::text[])`,
    [id, REGISTRY_CATEGORIES],
  )
  if (!row) return null

  const [series, topics, posts, errors] = await Promise.all([
    // Raw collection readings, not daily sums — a community collected six
    // times today has six points to draw, which is what "its own graph"
    // means on day one. `bucket` is normalised to an ISO string here so the
    // client never receives a Date object pretending to be one.
    q<{ bucket: string; posts: number; engagement: string; subscribers: string | null }>(
      `select captured_at as bucket, posts_new as posts, engagement, subscribers
         from reddit.subreddit_snapshots
        where subreddit = $1 and captured_at >= now() - interval '90 days'
        order by captured_at
        limit 400`,
      [id],
    ),
    q<{ id: string; name: string; mentions: number }>(
      `select t.id, t.name, count(*)::int as mentions
          from reddit.topic_mentions m join reddit.topic_entities t on t.id = m.topic_id and t.adult
        where m.subreddit = $1
        group by t.id, t.name order by count(*) desc limit 8`,
      [id],
    ),
    postRows({ subreddit: id, sort: 'score', limit: 8 }),
    q<{ at: string; error: string }>(
      `select updated_at as at, coalesce(error, 'collection failed') as error
         from reddit.collector_jobs
        where subreddit = $1 and state = 'failed'
        order by updated_at desc limit 10`,
      [id],
    ),
  ])

  return {
    subreddit: {
      ...row,
      subscribers: row.subscribers === null ? null : Number(row.subscribers),
      posts_collected: Number(row.posts_collected),
      engagement: Number(row.engagement),
    } as SubredditRow,
    series: series.map((point) => ({
      bucket: new Date(point.bucket).toISOString(),
      posts: Number(point.posts),
      engagement: Number(point.engagement),
      subscribers: point.subscribers === null ? null : Number(point.subscribers),
    })),
    topics,
    posts,
    // Operational errors are per-run notes; the subreddit's own last error is
    // already on the row. Both are shown, clearly labelled.
    errors,
  }
}

/** The last collection readings per community — the tracking table's trend
 *  spark. Raw readings, not days: on day one there is no day two yet, and a
 *  spark that only exists from tomorrow is not a spark. */
export async function subredditListSparks(ids: string[]): Promise<Map<string, number[]>> {
  if (!ids.length) return new Map()
  const rows = await q<{ subreddit: string; posts: number }>(
    `select subreddit, posts_new as posts from (
       select subreddit, posts_new, captured_at,
              row_number() over (partition by subreddit order by captured_at desc) as rn
         from reddit.subreddit_snapshots
        where captured_at >= now() - interval '30 days'
          and subreddit = any($1::text[])
     ) recent
      where rn <= 16
      order by subreddit, captured_at`,
    [ids],
  )
  const map = new Map<string, number[]>()
  for (const row of rows) {
    const list = map.get(row.subreddit) ?? []
    list.push(Number(row.posts))
    map.set(row.subreddit, list)
  }
  return map
}

export type CompareRow = {
  id: string
  category: string
  subscribers: number | null
  posts_30d: number
  engagement_30d: number
  avg_post_engagement: number | null
  posts_per_day: number | null
  series: { bucket: string; posts: number }[]
}

/** Side-by-side community comparison for up to six ids. */
export async function subredditCompare(ids: string[]): Promise<CompareRow[]> {
  const clean = ids.slice(0, 6)
  if (!clean.length) return []
  const [rows, series] = await Promise.all([
    q<{
      id: string; category: string; subscribers: string | null; posts: number; engagement: string
    }>(
      `select s.id, s.category, s.subscribers,
              count(p.id)::int as posts,
              coalesce(sum(coalesce(p.score,0) + coalesce(p.comments,0)), 0)::bigint as engagement
         from reddit.tracked_subreddits s
         left join reddit.reddit_posts p
           on p.subreddit = s.id and p.is_deleted = false and p.created_utc >= now() - interval '30 days'
         where s.id = any($1::text[]) and s.adult and s.category = any($2::text[])
        group by s.id, s.category, s.subscribers
        order by array_position($1::text[], s.id)`,
       [clean, REGISTRY_CATEGORIES],
    ),
    q<{ subreddit: string; bucket: string; posts: number }>(
      `select subreddit,
              to_char(date_trunc('day', captured_at at time zone 'UTC'), 'YYYY-MM-DD') as bucket,
              coalesce(sum(posts_new), 0)::int as posts
         from reddit.subreddit_snapshots
        where subreddit = any($1::text[]) and captured_at >= now() - interval '30 days'
        group by 1, 2 order by 1, 2`,
      [clean],
    ),
  ])
  const bySub = new Map<string, { bucket: string; posts: number }[]>()
  for (const point of series) {
    const list = bySub.get(point.subreddit) ?? []
    list.push({ bucket: point.bucket, posts: Number(point.posts) })
    bySub.set(point.subreddit, list)
  }
  return rows.map((row) => {
    const posts = Number(row.posts)
    const engagement = Number(row.engagement)
    return {
      id: row.id,
      category: row.category,
      subscribers: row.subscribers === null ? null : Number(row.subscribers),
      posts_30d: posts,
      engagement_30d: engagement,
      avg_post_engagement: posts ? Math.round(engagement / posts) : null,
      posts_per_day: posts ? Math.round((posts / 30) * 10) / 10 : null,
      series: bySub.get(row.id) ?? [],
    }
  })
}

/* -------------------------------------------------------------- search */

export type SearchResult = {
  query: string
  counts: { posts: number; topics: number; subreddits: number; mentions: number }
  posts: OverviewPost[]
  topics: OverviewTopic[]
  subreddits: { id: string; display_name: string; category: string; posts_collected: number; status: string }[]
  mentions: { post_id: string; title: string; topic_id: string; topic_name: string; subreddit: string; score: number | null; comments: number | null; created_utc: string }[]
}

export async function searchAll(query: string, limit = 25): Promise<SearchResult> {
  const like = `%${query.toLowerCase()}%`
  const adultOnly = await adultScope()
  const [posts, topics, subs, mentions, counts] = await Promise.all([
    postRows({ search: query, sort: 'score', limit }),
    topicRows({ search: query, sort: 'interest', limit: 12 }),
    q<{ id: string; display_name: string; category: string; posts_collected: number; status: string }>(
      `select s.id, s.display_name, s.category, s.status,
              (select count(*)::int from reddit.reddit_posts p where p.subreddit = s.id and p.is_deleted = false) as posts_collected
         from reddit.tracked_subreddits s
        where (not $2::boolean or s.adult)
          and (lower(s.id) like $1 or lower(coalesce(s.title,'')) like $1 or lower(coalesce(s.description,'')) like $1)
        order by s.display_name limit 12`,
      [like, adultOnly],
    ),
    q<{ post_id: string; title: string; topic_id: string; topic_name: string; subreddit: string; score: number | null; comments: number | null; created_utc: string }>(
      `select m.post_id, p.title, m.topic_id, t.name as topic_name, m.subreddit, p.score, p.comments, p.created_utc
         from reddit.topic_mentions m
         join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
         join reddit.tracked_subreddits ts on ts.id = m.subreddit and (not $2::boolean or ts.adult)
          join reddit.topic_entities t on t.id = m.topic_id and t.adult
        where lower(p.title) like $1
        order by (coalesce(p.score,0) + coalesce(p.comments,0)) desc
        limit 20`,
      [like, adultOnly],
    ),
    q<{ posts: number; topics: number; subreddits: number; mentions: number }>(
      `select
         (select count(*)::int from reddit.reddit_posts p where p.is_deleted = false and lower(p.title) like $1
            and (not $2::boolean or exists (
                  select 1 from reddit.tracked_subreddits ts where ts.id = p.subreddit and ts.adult))) as posts,
          (select count(*)::int from reddit.topic_entities where adult and (lower(name) like $1 or lower(id) like $1)) as topics,
         (select count(*)::int from reddit.tracked_subreddits s
           where (not $2::boolean or s.adult)
             and (lower(s.id) like $1 or lower(coalesce(s.title,'')) like $1)) as subreddits,
          (select count(*)::int from reddit.topic_mentions m
             join reddit.reddit_posts p on p.id = m.post_id and p.is_deleted = false
             join reddit.topic_entities t on t.id = m.topic_id and t.adult
           where lower(p.title) like $1
             and (not $2::boolean or exists (
                   select 1 from reddit.tracked_subreddits ts where ts.id = m.subreddit and ts.adult))) as mentions`,
      [like, adultOnly],
    ),
  ])
  return {
    query,
    counts: counts[0] ?? { posts: 0, topics: 0, subreddits: 0, mentions: 0 },
    posts,
    topics,
    subreddits: subs,
    mentions,
  }
}

/* -------------------------------------------------------------- dataset */

export type DatasetStats = {
  registry: { candidates: number; unique: number }
  tracked: number
  eligible: number
  active: number
  adult: number
  posts: number
  post_snapshots: number
  topic_snapshots: number
  mentions: number
  subreddit_snapshots: number
  alerts: number
  storage_bytes: number
  freshness: string | null
  oldest_post: string | null
  api_24h: { requests: number; errors: number }
  api_7d: { requests: number; errors: number }
  retention: { days: number; post_days: number; export_raw_enabled: boolean }
}

export async function datasetStats(): Promise<DatasetStats> {
  const settings = await getSettings()
  const adultOnly = settings.adult_only
  const [counts, sizes, usage24, usage7] = await Promise.all([
    q<{
      tracked: number; eligible: number; active: number; adult: number; posts: number;
      post_snapshots: number; topic_snapshots: number; mentions: number; subreddit_snapshots: number; alerts: number
    }>(
      `select
         (select count(*)::int from reddit.tracked_subreddits where (not $1::boolean or adult)) as tracked,
         (select count(*)::int from reddit.tracked_subreddits
           where enabled and not paused and status in ('active','pending') and (not $1::boolean or adult)) as eligible,
         (select count(*)::int from reddit.tracked_subreddits where status = 'active' and (not $1::boolean or adult)) as active,
         (select count(*)::int from reddit.tracked_subreddits where adult) as adult,
         (select count(*)::int from reddit.reddit_posts p
           where (not $1::boolean or exists (
                 select 1 from reddit.tracked_subreddits ts where ts.id = p.subreddit and ts.adult))) as posts,
         (select count(*)::int from reddit.reddit_post_metric_snapshots) as post_snapshots,
          (select count(*)::int from reddit.topic_metric_snapshots s
             join reddit.topic_entities t on t.id = s.topic_id and t.adult) as topic_snapshots,
          (select count(*)::int from reddit.topic_mentions m
             join reddit.topic_entities t on t.id = m.topic_id and t.adult
             join reddit.tracked_subreddits ts on ts.id = m.subreddit and ts.adult) as mentions,
         (select count(*)::int from reddit.subreddit_snapshots) as subreddit_snapshots,
         (select count(*)::int from reddit.trend_alerts) as alerts`,
      [adultOnly],
    ),
    q<{ bytes: string }>(
      `select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as bytes
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'reddit' and c.relkind = 'r'`,
    ),
    q<{ requests: number; errors: number }>(
      `select count(*)::int as requests, count(*) filter (where status is null or status >= 400)::int as errors
         from reddit.api_usage where at >= now() - interval '24 hours'`,
    ),
    q<{ requests: number; errors: number }>(
      `select count(*)::int as requests, count(*) filter (where status is null or status >= 400)::int as errors
         from reddit.api_usage where at >= now() - interval '7 days'`,
    ),
  ])
  const [fresh] = await q<{ synced: string | null; oldest: string | null }>(
    `select (select max(last_synced_at) from reddit.tracked_subreddits) as synced,
            (select min(created_utc) from reddit.reddit_posts) as oldest`,
  )
  const row = counts[0]
  return {
    registry: registryCounts(),
    tracked: Number(row?.tracked ?? 0),
    eligible: Number(row?.eligible ?? 0),
    active: Number(row?.active ?? 0),
    adult: Number(row?.adult ?? 0),
    posts: Number(row?.posts ?? 0),
    post_snapshots: Number(row?.post_snapshots ?? 0),
    topic_snapshots: Number(row?.topic_snapshots ?? 0),
    mentions: Number(row?.mentions ?? 0),
    subreddit_snapshots: Number(row?.subreddit_snapshots ?? 0),
    alerts: Number(row?.alerts ?? 0),
    storage_bytes: Number(sizes[0]?.bytes ?? 0),
    freshness: fresh?.synced ?? null,
    oldest_post: fresh?.oldest ?? null,
    api_24h: usage24[0] ?? { requests: 0, errors: 0 },
    api_7d: usage7[0] ?? { requests: 0, errors: 0 },
    retention: { days: settings.retention_days, post_days: settings.retention_post_days, export_raw_enabled: settings.export_raw_enabled },
  }
}

/* --------------------------------------------------------------- health */

export type HealthData = {
  configured: boolean
  paused: boolean
  emergency_stop: boolean
  last_run: CollectorRun | null
  runs: CollectorRun[]
  jobs: { state: string; n: number }[]
  usage_hourly: { bucket: string; requests: number; errors: number; remaining: number | null }[]
  problem_subreddits: { id: string; status: string; note: string | null; last_error: string | null; failures: number }[]
  budget: { per_run: number; min_interval_ms: number; safety_ratio: number; hourly_cap: number }
  /** Everything the API-safety panel says, from real headers and rows. */
  rate: {
    remaining: number | null
    used: number | null
    reset_at: string | null
    cooldown_until: string | null
    blocked_24h: number
    requests_1h: number
  }
  /** The monitoring scheduler, as the health board reads it. */
  scheduler: {
    tracked: number
    scanned_today: number
    remaining_scans: number
    requests_today: number
    daily_cap: number
    remaining_budget: number
    next_scan_at: string | null
    paused: number
    inaccessible: number
    oauth_ok_at: string | null
  }
  stale: boolean
}

export async function healthData(): Promise<HealthData> {
  const settings = await getSettings()
  const scope = settings.adult_only
  const [runs, jobs, usage, problems, configured, seeded, hourUsage, dayUsage,
    coverage, requestsToday, queue, oauth] = await Promise.all([
    q<CollectorRun>(
      `select id, started_at, finished_at, trigger, state, subreddits, requests, posts_new, posts_updated,
              mentions, errors, budget, remaining, note
         from reddit.collector_runs order by started_at desc limit 12`,
    ),
    q<{ state: string; n: number }>(
      `select state, count(*)::int as n from reddit.collector_jobs group by state`,
    ),
    q<{ bucket: string; requests: number; errors: number; remaining: number | null }>(
      `select to_char(date_trunc('hour', at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00') as bucket,
              count(*)::int as requests,
              count(*) filter (where status is null or status >= 400)::int as errors,
              max(remaining) as remaining
         from reddit.api_usage
        where at >= now() - interval '24 hours'
        group by 1 order by 1`,
    ),
    q<{ id: string; status: string; note: string | null; last_error: string | null; failures: number }>(
      `select id, status, status_note as note, last_error, consecutive_failures as failures
         from reddit.tracked_subreddits
        where (status in ('error','restricted','unavailable','quarantined') or consecutive_failures > 0)
          and (not $1::boolean or adult)
        order by consecutive_failures desc, id limit 40`,
      [settings.adult_only],
    ),
    (await import('./client')).redditConfigured(),
    latestRateState(),
    usageSummary(1),
    usageSummary(24),
    q<{ tracked: number; scanned_today: number; paused: number; inaccessible: number }>(
      `select
         count(*) filter (where (not $1::boolean or adult))::int as tracked,
         count(*) filter (where (not $1::boolean or adult)
                             and last_synced_at >= date_trunc('day', now()))::int as scanned_today,
         count(*) filter (where (not $1::boolean or adult) and paused)::int as paused,
         count(*) filter (where (not $1::boolean or adult)
                             and status in ('restricted','unavailable','quarantined','error'))::int as inaccessible
        from reddit.tracked_subreddits`,
      [scope],
    ),
    usageToday(),
    queueState(scope),
    q<{ ok_at: string | null }>(`select max(at) as ok_at from reddit.api_usage where status = 200`),
  ])
  const last = runs[0] ?? null
  const stale = !last || Date.now() - Date.parse(last.started_at) > 6 * 3_600_000
  return {
    configured,
    paused: settings.paused,
    emergency_stop: settings.emergency_stop,
    last_run: last,
    runs,
    jobs,
    usage_hourly: usage,
    problem_subreddits: problems,
    budget: {
      per_run: settings.budget_per_run,
      min_interval_ms: settings.min_interval_ms,
      safety_ratio: settings.safety_ratio,
      hourly_cap: settings.hourly_cap,
    },
    rate: {
      remaining: seeded?.remaining ?? null,
      used: seeded?.used ?? null,
      reset_at: seeded && seeded.resetSeconds !== null ? new Date(seeded.at + seeded.resetSeconds * 1000).toISOString() : null,
      cooldown_until: settings.rate_cooldown_until,
      blocked_24h: dayUsage.blocked,
      requests_1h: hourUsage.requests,
    },
    scheduler: {
      tracked: Number(coverage[0]?.tracked ?? 0),
      scanned_today: Number(coverage[0]?.scanned_today ?? 0),
      remaining_scans: Math.max(0, Number(coverage[0]?.tracked ?? 0) - Number(coverage[0]?.scanned_today ?? 0)),
      requests_today: requestsToday,
      daily_cap: settings.daily_cap,
      remaining_budget: Math.max(0, settings.daily_cap - requestsToday),
      next_scan_at: queue.nextAt,
      paused: Number(coverage[0]?.paused ?? 0),
      inaccessible: Number(coverage[0]?.inaccessible ?? 0),
      oauth_ok_at: oauth[0]?.ok_at ?? null,
    },
    stale,
  }
}

/* --------------------------------------------------------------- alerts */

const ALERT_SCOPE = `
  (a.kind not like 'topic_%' or exists (
    select 1 from reddit.topic_entities t where t.id = a.subject and t.adult))
  and (a.kind <> 'subreddit_spike' or exists (
    select 1 from reddit.tracked_subreddits s where s.id = a.subject and s.adult))`

export async function alertsList(limit = 50): Promise<AlertRow[]> {
  return q<AlertRow>(
    `select id, dedupe_key, kind, subject, title, body, severity, created_at, seen_at
       from reddit.trend_alerts a where ${ALERT_SCOPE} order by created_at desc limit $1`,
    [limit],
  )
}

export async function alertsUnseenCount(): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n from reddit.trend_alerts a where seen_at is null and ${ALERT_SCOPE}`,
  )
  return Number(row?.n ?? 0)
}

/* ------------------------------------------------- requirements board */

export type RequirementQuery = {
  search?: string | null
  category?: string | null
  /** 'with' = Bot Bouncer installed, 'without' = checked and not installed.
   *  Unknown rows are excluded from both — the board never guesses. */
  botBouncer?: 'all' | 'with' | 'without'
  /** The "Display nsfw subreddits" switch. Null keeps both. */
  includeNsfw?: boolean
  list?: string | null
  status?: string | null
  limit?: number
  offset?: number
}

export type RequirementBoardMeta = {
  total: number
  with_bot_bouncer: number
  without_bot_bouncer: number
  unknown_bot_bouncer: number
  nsfw: number
  categories: string[]
  last_updated: string | null
  next_due_at: string | null
  due_now: number
}

export async function requirementRows(filters: RequirementQuery = {}): Promise<RequirementRow[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`)
    conditions.push(`(lower(s.id) like $${params.length} or lower(s.display_name) like $${params.length})`)
  }
  if (filters.category) {
    params.push(filters.category)
    conditions.push(`s.category = $${params.length}`)
  }
  if (filters.botBouncer === 'with') conditions.push(`s.bot_bouncer = 'yes'`)
  if (filters.botBouncer === 'without') conditions.push(`s.bot_bouncer = 'no'`)
  if (filters.includeNsfw === false) conditions.push(`not s.over18`)
  if (filters.status) {
    params.push(filters.status)
    conditions.push(`s.status = $${params.length}`)
  }
  if (filters.list) {
    params.push(filters.list)
    conditions.push(`exists (select 1 from reddit.subreddit_list_items i where i.list_id = $${params.length} and i.subreddit = s.id)`)
  }
  const where = conditions.length ? ` where ${conditions.join(' and ')}` : ''
  params.push(Math.min(1000, Math.max(1, filters.limit ?? 400)))
  params.push(Math.max(0, filters.offset ?? 0))
  const rows = await q<RequirementRow>(
    `select s.* from reddit.requirement_subreddits s${where}
      order by s.subscribers desc nulls last, s.display_name
      limit $${params.length - 1} offset $${params.length}`,
    params,
  )
  const numeric = rows.map(normalizeRequirementRow)
  const sources = await requirementSourceMap(numeric.map((row) => row.id))
  for (const row of numeric) row.sources = sources.get(row.id) ?? []
  return numeric
}

/** Neon hands bigints back as strings; the board deals in numbers. */
function normalizeRequirementRow(row: RequirementRow): RequirementRow {
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return {
    ...row,
    subscribers: num(row.subscribers),
    posts_per_day: num(row.posts_per_day),
    sample_count: Number(row.sample_count ?? 0),
    survivor_count: Number(row.survivor_count ?? 0),
    filtered_count: Number(row.filtered_count ?? 0),
    profile_count: Number(row.profile_count ?? 0),
    min_post_karma: num(row.min_post_karma),
    min_comment_karma: num(row.min_comment_karma),
    min_age_days: num(row.min_age_days),
    avg_total_karma: num(row.avg_total_karma),
    confirmations: Number(row.confirmations ?? 0),
    consecutive_failures: Number(row.consecutive_failures ?? 0),
  }
}

/** Up to four pieces of evidence per community for the table's inline
 *  source list: any AutoMod-filtered authors first (they hold the floor),
 *  then the lowest-karma survivors (they hold the ceiling). */
export async function requirementSourceMap(ids: string[]): Promise<Map<string, RequirementSource[]>> {
  const map = new Map<string, RequirementSource[]>()
  if (!ids.length) return map
  const rows = await q<RequirementSource & { subreddit: string }>(
    `select subreddit, post_id, author, permalink, outcome, link_karma, comment_karma,
            account_age_days, post_created_utc
       from (
         select s.*,
                row_number() over (
                  partition by s.subreddit
                  order by (s.outcome = 'filtered') desc, s.link_karma asc nulls last, s.sampled_at desc
                ) as rn
           from reddit.requirement_samples s
          where s.subreddit = any($1::text[])
       ) ranked
      where rn <= 4`,
    [ids],
  )
  for (const row of rows) {
    const list = map.get(row.subreddit) ?? []
    list.push({
      post_id: row.post_id,
      author: row.author,
      permalink: row.permalink,
      outcome: row.outcome,
      link_karma: row.link_karma === null ? null : Number(row.link_karma),
      comment_karma: row.comment_karma === null ? null : Number(row.comment_karma),
      account_age_days: row.account_age_days === null ? null : Number(row.account_age_days),
      post_created_utc: row.post_created_utc,
    })
    map.set(row.subreddit, list)
  }
  return map
}

export async function requirementBoardMeta(): Promise<RequirementBoardMeta> {
  const [counts, categories] = await Promise.all([
    q<{
      total: number; with_bb: number; without_bb: number; unknown_bb: number; nsfw: number;
      last_updated: string | null; next_due_at: string | null; due_now: number
    }>(
      `select count(*)::int as total,
              count(*) filter (where bot_bouncer = 'yes')::int as with_bb,
              count(*) filter (where bot_bouncer = 'no')::int as without_bb,
              count(*) filter (where bot_bouncer = 'unknown')::int as unknown_bb,
              count(*) filter (where over18)::int as nsfw,
              max(last_collected_at) as last_updated,
              min(next_due_at) filter (where enabled and status in ('pending','active')) as next_due_at,
              count(*) filter (where enabled and status in ('pending','active')
                                 and (next_due_at is null or next_due_at <= now()))::int as due_now
         from reddit.requirement_subreddits`,
    ),
    q<{ category: string }>(
      `select distinct category from reddit.requirement_subreddits order by category`,
    ),
  ])
  const row = counts[0]
  return {
    total: Number(row?.total ?? 0),
    with_bot_bouncer: Number(row?.with_bb ?? 0),
    without_bot_bouncer: Number(row?.without_bb ?? 0),
    unknown_bot_bouncer: Number(row?.unknown_bb ?? 0),
    nsfw: Number(row?.nsfw ?? 0),
    categories: categories.map((entry) => entry.category),
    last_updated: row?.last_updated ?? null,
    next_due_at: row?.next_due_at ?? null,
    due_now: Number(row?.due_now ?? 0),
  }
}

/* -------------------------------------------------------------- export */

export type ExportKind = 'topics' | 'subreddits' | 'posts'

export async function exportRows(kind: ExportKind): Promise<Record<string, string | number | null>[]> {
  if (kind === 'topics') {
    const rows = await topicRows({ sort: 'interest', limit: 500 })
    return rows.map((row) => ({
      topic_id: row.id, name: row.name, category: row.category,
      interest: row.interest, growth: row.growth, mentions: row.mentions,
      velocity: row.velocity, communities: row.subreddits, status: row.status,
    }))
  }
  if (kind === 'subreddits') {
    const rows = await q<{
      id: string; category: string; status: string; priority: string; subscribers: string | null;
      posts: number; engagement: string; last_synced_at: string | null
    }>(
      `select s.id, s.category, s.status, s.priority, s.subscribers,
              (select count(*)::int from reddit.reddit_posts p where p.subreddit = s.id and p.is_deleted = false) as posts,
              (select coalesce(sum(coalesce(p.score,0) + coalesce(p.comments,0)), 0)::bigint from reddit.reddit_posts p where p.subreddit = s.id and p.is_deleted = false) as engagement,
              s.last_synced_at
         from reddit.tracked_subreddits s
        where (not $1::boolean or s.adult)
        order by s.category, s.id`,
      [await adultScope()],
    )
    return rows.map((row) => ({
      subreddit: row.id, category: row.category, status: row.status, priority: row.priority,
      subscribers: row.subscribers === null ? null : Number(row.subscribers),
      posts: Number(row.posts), engagement: Number(row.engagement), last_synced_at: row.last_synced_at,
    }))
  }
  // Posts: metadata only, and only when the admin has explicitly authorised
  // raw-content export. The licence note on the Dataset page says why.
  const rows = await postRows({ sort: 'recent', limit: 500 })
  return rows.map((row) => ({
    post_id: row.id, subreddit: row.subreddit, title: row.title,
    score: row.score, comments: row.comments, created_utc: row.created_utc,
    velocity: row.velocity, permalink: row.permalink,
  }))
}

/** Tiny CSV writer, Excel-safe. */
export function toCsv(rows: Record<string, string | number | null>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const quote = (value: string | number | null) =>
    value === null || value === undefined ? '' : `"${String(value).replace(/"/g, '""')}"`
  return [headers.join(','), ...rows.map((row) => headers.map((header) => quote(row[header] ?? null)).join(','))].join('\n')
}
