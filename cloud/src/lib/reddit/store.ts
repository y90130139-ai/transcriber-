/**
 * Every write and every small read the Reddit Trends feature makes. The
 * bigger page-facing reads live in queries.ts; this file is the collector's
 * half — seeding, subreddit lifecycle, posts, mentions, runs, usage, alerts,
 * retention — plus the helpers both halves share.
 */

import { q, sql } from '../db'
import { REGISTRY_CATEGORIES, REGISTRY_CANDIDATE_COUNT, TOPIC_CATEGORIES, subredditKey, uniqueCandidates, uniqueCandidateCount, type RegistryCandidate } from './registry'
import { SEED_TOPICS } from './keywords'
import type { RedditSettings, RequirementGates, RequirementSource } from './types'
import type { RequestUsage } from './client'

/* ------------------------------------------------------------------ seed */

export type SeedResult = { candidates: number; unique: number; subreddits: number; topics: number }

let seedPromise: Promise<SeedResult> | null = null

/**
 * Idempotent onboarding, memoized per process so a page load can call it
 * without paying three upserts each time. A failed attempt resets the memo
 * so the next call retries.
 */
export function seedRegistry(): Promise<SeedResult> {
  seedPromise ??= seedRegistryNow().catch((error) => {
    seedPromise = null
    throw error
  })
  return seedPromise
}

/**
 * Communities and seed topics are inserted once — `on conflict do nothing`
 * on the community so an admin's category, pause or priority is never
 * overwritten by a later deploy of this file. Topics do update their
 * keyword list, because a fixed matching rule is a deploy-time concern
 * rather than an admin one.
 */
async function seedRegistryNow(): Promise<SeedResult> {
  const candidates = uniqueCandidates()
  let subreddits = 0
  for (const chunk of chunks(candidates, 40)) {
    const ids = chunk.map((c) => subredditKey(c.name))
    const display = chunk.map((c) => c.name.replace(/^\/?r\//i, ''))
    const category = chunk.map((c) => c.category)
    const adult = chunk.map((c) => c.adult)
    const enabled = chunk.map((c) => !c.adult)
    const rows = await q<{ id: string }>(
      `insert into reddit.tracked_subreddits
         (id, display_name, category, url, adult, enabled, priority, interval_minutes, source, status)
       select id, name, cat, 'https://www.reddit.com/r/' || name || '/', adult, enabled,
              'medium', 60, 'seed', 'pending'
         from unnest($1::text[], $2::text[], $3::text[], $4::boolean[], $5::boolean[])
              as t(id, name, cat, adult, enabled)
       on conflict (id) do nothing
       returning id`,
      [ids, display, category, adult, enabled],
    )
    subreddits += rows.length
  }

  let topics = 0
  for (const chunk of chunks(SEED_TOPICS, 40)) {
    const ids = chunk.map((t) => t.slug)
    const names = chunk.map((t) => t.name)
    const categories = chunk.map((t) => t.category)
    // Keyword lists are arrays-of-arrays; jsonb[] carries them through one
    // unnest without the multidim flattening that would misalign rows.
    const keywords = chunk.map((t) => JSON.stringify(t.keywords))
    const adult = chunk.map((t) => t.adult)
    const creator = chunk.map((t) => t.creator)
    const rows = await q<{ id: string }>(
      `insert into reddit.topic_entities (id, name, category, keywords, source, adult, creator)
       select id, name, cat, array(select jsonb_array_elements_text(kw)), 'registry', adult, creator
         from unnest($1::text[], $2::text[], $3::text[], $4::jsonb[], $5::boolean[], $6::boolean[])
              as t(id, name, cat, kw, adult, creator)
       on conflict (id) do update
         set name = excluded.name,
             category = excluded.category,
             keywords = excluded.keywords,
             adult = excluded.adult,
             creator = excluded.creator,
             updated_at = now()
       where reddit.topic_entities.source = 'registry'
       returning id`,
      [ids, names, categories, keywords, adult, creator],
    )
    topics += rows.length
  }

  return { candidates: REGISTRY_CANDIDATE_COUNT, unique: uniqueCandidateCount(), subreddits, topics }
}

/** What the registry holds, for the Dataset page. */
export function registryCounts(): { candidates: number; unique: number } {
  return { candidates: REGISTRY_CANDIDATE_COUNT, unique: uniqueCandidateCount() }
}

export async function countTrackedSubreddits(adultOnly = false): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n from reddit.tracked_subreddits
      where enabled and not paused and (not $1::boolean or adult)`,
    [adultOnly],
  )
  return Number(row?.n ?? 0)
}

/* ------------------------------------------------------------- subreddits */

export type SubredditDbRow = {
  id: string
  display_name: string
  category: string
  url: string | null
  title: string | null
  description: string | null
  subscribers: string | number | null
  over18: boolean
  adult: boolean
  enabled: boolean
  paused: boolean
  priority: 'high' | 'medium' | 'low'
  interval_minutes: number
  status: string
  status_note: string | null
  validated_at: string | null
  last_synced_at: string | null
  last_error: string | null
  consecutive_failures: number
  source: 'seed' | 'manual'
  posts_collected: number
  engagement: number
  spark?: number[]
  /** Joined by the subreddits route from the requirements board —
   *  the merged board's gate columns and their evidence. */
  gates?: RequirementGates | null
  gate_sources?: RequirementSource[]
}

const SUBREDDIT_SELECT = `
  select s.*,
         coalesce(p.posts, 0)::int as posts_collected,
         coalesce(p.engagement, 0)::int as engagement
    from reddit.tracked_subreddits s
    left join (
      select subreddit, count(*) as posts, sum(coalesce(score,0) + coalesce(comments,0)) as engagement
        from reddit.reddit_posts
       where is_deleted = false
       group by subreddit
    ) p on p.subreddit = s.id`

export async function listSubreddits(filters: {
  search?: string
  category?: string
  status?: string
  priority?: string
  enabled?: boolean | null
  adultOnly?: boolean
} = {}): Promise<SubredditDbRow[]> {
  const conditions = [`s.category = any($1::text[])`]
  const params: unknown[] = [REGISTRY_CATEGORIES]
  if (filters.adultOnly) conditions.push(`s.adult`)
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`)
    conditions.push(`(lower(s.id) like $${params.length} or lower(coalesce(s.title,'')) like $${params.length})`)
  }
  if (filters.category) { params.push(filters.category); conditions.push(`s.category = $${params.length}`) }
  if (filters.status) { params.push(filters.status); conditions.push(`s.status = $${params.length}`) }
  if (filters.priority) { params.push(filters.priority); conditions.push(`s.priority = $${params.length}`) }
  if (filters.enabled === true) conditions.push(`s.enabled = true`)
  if (filters.enabled === false) conditions.push(`s.enabled = false`)
  const where = conditions.length ? ` where ${conditions.join(' and ')}` : ''
  return q<SubredditDbRow>(
    `${SUBREDDIT_SELECT}${where} order by s.category, s.display_name`,
    params,
  )
}

export async function getSubreddit(id: string): Promise<SubredditDbRow | null> {
  const rows = await q<SubredditDbRow>(`${SUBREDDIT_SELECT} where s.id = $1`, [subredditKey(id)])
  return rows[0] ?? null
}

/** Add by name or URL. Refuses duplicates on the canonical key. The caller
 *  decides `enabled` (it knows the adult gate); `adult` is derived from the
 *  category and re-confirmed from Reddit's own over18 flag at validation. */
export async function addSubreddit(input: {
  key: string
  display: string
  category: string
  adult?: boolean
  enabled?: boolean
}): Promise<{ ok: boolean; reason?: string }> {
  const existing = await q<{ id: string }>(
    `select id from reddit.tracked_subreddits where id = $1`,
    [input.key],
  )
  if (existing.length) return { ok: false, reason: `${input.display} is already tracked` }
  const adult = Boolean(input.adult)
  const enabled = input.enabled ?? !adult
  await sql.query(
    `insert into reddit.tracked_subreddits
       (id, display_name, category, url, source, status, enabled, adult, priority, interval_minutes)
     values ($1, $2, $3, 'https://www.reddit.com/r/' || $2 || '/', 'manual', 'pending', $4, $5, 'medium', 60)`,
    [input.key, input.display, input.category, enabled, adult],
  )
  return { ok: true }
}

export type SubredditPatch = {
  category?: string
  enabled?: boolean
  paused?: boolean
  priority?: 'high' | 'medium' | 'low'
  interval_minutes?: number
  status?: string
  adult?: boolean
}

export async function updateSubreddit(id: string, patch: SubredditPatch): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = [subredditKey(id)]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    params.push(value)
    sets.push(`${key} = $${params.length}`)
  }
  if (!sets.length) return
  await sql.query(
    `update reddit.tracked_subreddits set ${sets.join(', ')}, updated_at = now() where id = $1`,
    params,
  )
}

export async function deleteSubreddit(id: string): Promise<void> {
  await sql.query(`delete from reddit.tracked_subreddits where id = $1`, [subredditKey(id)])
}

export type AboutResult = {
  title?: string
  description?: string
  subscribers?: number
  over18?: boolean
}

export async function markSubredditValidated(
  id: string,
  outcome:
    | { status: 'active'; about: AboutResult }
    | { status: 'unavailable' | 'restricted' | 'quarantined' | 'error'; note: string },
): Promise<void> {
  if (outcome.status === 'active') {
    await sql.query(
      `update reddit.tracked_subreddits
          set status = 'active', status_note = null, title = coalesce($2, title),
              description = coalesce($3, description), subscribers = coalesce($4, subscribers),
              over18 = coalesce($5, over18),
              -- Reddit's own 18+ flag is the authoritative adult marker:
              -- once seen, the row is flagged even if a category said not.
              adult = adult or coalesce($5, false), validated_at = now(),
              consecutive_failures = 0, last_error = null, updated_at = now()
        where id = $1`,
      [
        subredditKey(id),
        outcome.about.title ?? null,
        outcome.about.description ?? null,
        outcome.about.subscribers ?? null,
        outcome.about.over18 ?? null,
      ],
    )
    return
  }
  await sql.query(
    `update reddit.tracked_subreddits
        set status = $2, status_note = $3, validated_at = now(), enabled = false, updated_at = now()
      where id = $1`,
    [subredditKey(id), outcome.status, outcome.note],
  )
}

/** The adult gate flipping on: validated adult communities join collection.
 *  Pending ones stay off until validation actually grants access. */
export async function enableValidatedAdultSubreddits(): Promise<number> {
  const rows = await q<{ id: string }>(
    `update reddit.tracked_subreddits
        set enabled = true, updated_at = now()
      where adult and status = 'active' and not paused
      returning id`,
  )
  return rows.length
}

/** The adult gate closing: every adult community stops being collected,
 *  whatever its validation state. */
export async function disableAdultSubreddits(): Promise<number> {
  const rows = await q<{ id: string }>(
    `update reddit.tracked_subreddits
        set enabled = false, updated_at = now()
      where adult and enabled
      returning id`,
  )
  return rows.length
}

/** Record the outcome of one collection against a community. */
export async function markSubredditSynced(id: string, error: string | null): Promise<void> {
  if (error) {
    await sql.query(
      `update reddit.tracked_subreddits
          set last_synced_at = now(), last_error = $2,
              consecutive_failures = consecutive_failures + 1,
              status = case when status in ('pending','active') and consecutive_failures + 1 >= 5
                            then 'error' else status end,
              updated_at = now()
        where id = $1`,
      [subredditKey(id), error.slice(0, 400)],
    )
    return
  }
  await sql.query(
    `update reddit.tracked_subreddits
        set last_synced_at = now(), last_error = null, consecutive_failures = 0,
            status = case when status = 'pending' then 'active' else status end,
            updated_at = now()
      where id = $1`,
    [subredditKey(id)],
  )
}

/* ------------------------------------------------------------ collector jobs */

export type JobRow = { id: string; subreddit: string; priority: string }

/**
 * Enqueue one job per community that is due under its own interval. The id
 * is derived from the community and the exact due time, so two schedulers
 * racing cannot enqueue the same slot twice and a restart resumes rather
 * than duplicates.
 *
 * Geno, 2026-10-18: it used to be the interval-wide bucket, and that
 * starved communities. The 0.80–0.95 spread on the due time walks it a few
 * hours earlier every cycle, so eventually the next due landed in the same
 * bucket as the job that had just finished — `on conflict do nothing`
 * swallowed the enqueue and the community was never scanned again
 * (onlyfanspromo sat four days stale while its queue looked healthy). The
 * due time itself is deterministic for a given last_synced_at, so keying on
 * it dedupes exactly as well and can never collide with a past cycle.
 */
export async function enqueueDueJobs(settings: RedditSettings): Promise<number> {
  await purgeOutOfScopeJobs(settings.adult_only)
  // The due time is the scheduler's whole model: last sync + the priority
  // target, shortened for busy communities (activity from the last day of
  // snapshots), and never longer than 20 hours so daily coverage holds even
  // if a target is configured past a day. The job's id is the due time
  // itself, so two enqueuers racing cannot duplicate a slot, and due_at in
  // the past is what makes the queue claim oldest-due-first.
  const rows = await q<{ id: string }>(
    `with base as (
       select s.id, s.priority, s.last_synced_at,
              greatest(15, least(1440,
                (case s.priority when 'high' then $1::int when 'low' then $3::int else $2::int end)
                * (case when a.activity >= 100 then 0.8 when a.activity >= 30 then 0.9 else 1 end)
              ))::int as interval_min
         from reddit.tracked_subreddits s
         left join lateral (
           select coalesce(sum(ss.posts_new), 0)::int as activity
             from reddit.subreddit_snapshots ss
            where ss.subreddit = s.id and ss.captured_at >= now() - interval '24 hours'
         ) a on true
        where s.enabled and not s.paused
          and s.status in ('active','pending')
          and ($4::boolean or not s.adult)
          and (not $5::boolean or s.adult)
     ), due as (
       select id, priority, interval_min,
              -- The next scan is scheduled the moment the last one lands,
              -- with its due time in the future: the gap is visible on the
              -- board, and claims only ever pick what is actually due. The
              -- 80–95% spread (same as spreadFactor() in schedule.ts) means
              -- a fleet synced in one sweep comes due across hours, not in
              -- one wave; the factor is ≤ 1, so "once every 24 hours" holds.
              coalesce(last_synced_at, now() - interval '1 day')
                + interval_min * (0.80 + (abs(hashtext(id)::bigint) % 16)::numeric / 100) * interval '1 minute'
                as due_at
         from base
     )
     insert into reddit.collector_jobs (id, subreddit, listing, due_at, priority, state)
     -- The id is the due instant itself, so re-running is idempotent and one
     -- community never has two jobs for the same scan.
     select id || ':' || floor(extract(epoch from due_at))::text,
            id, 'new', due_at, priority, 'queued'
       from due
     on conflict (id) do nothing
     returning id`,
    [settings.high_interval_minutes, settings.medium_interval_minutes, settings.low_interval_minutes, settings.adult_enabled, settings.adult_only],
  )
  // One queued scan per community, and it is the earliest computed one.
  // Geno, 2026-10-18: this used to keep the latest due slot, which meant
  // shortening a cadence was silently ignored until the old, slower slot
  // fired (the 24h -> 6h change did nothing for a day). A slot that fires
  // earlier than a lengthened interval costs one extra bounded scan;
  // keeping the earliest makes every cadence change take effect at once.
  await q(
    `delete from reddit.collector_jobs j
      where j.state = 'queued'
        and exists (
          select 1 from reddit.collector_jobs k
           where k.subreddit = j.subreddit and k.state = 'queued'
             and (k.due_at < j.due_at or (k.due_at = j.due_at and k.id < j.id))
        )`,
  )
  return rows.length
}

/**
 * Claim up to `limit` queued jobs, oldest due first. Due time is the
 * priority score (interval, activity, staleness all folded into it at
 * enqueue), and FIFO on it is the fairness guarantee: a quiet community
 * due at 09:00 is served before a busy one due at 09:05. The locking is
 * `FOR UPDATE SKIP LOCKED`, so overlapping cron runs can never claim the
 * same job twice. Scope is enforced here too, so jobs queued before a
 * scope change can never slip through.
 */
export async function claimJobs(limit: number, adultOnly = false): Promise<JobRow[]> {
  return q<JobRow>(
     `with picked as (
       select j.id
         from reddit.collector_jobs j
         join reddit.tracked_subreddits s on s.id = j.subreddit
        where j.state = 'queued' and j.due_at <= now()
          and s.enabled and not s.paused and s.status in ('active','pending')
          and (not $2::boolean or s.adult)
        order by j.due_at asc,
                 case j.priority when 'high' then 0 when 'medium' then 1 else 2 end asc
        limit $1
        for update of j skip locked
     )
     update reddit.collector_jobs j
        set state = 'running', attempts = attempts + 1, updated_at = now()
       from picked
      where j.id = picked.id
      returning j.id, j.subreddit, j.priority`,
    [limit, adultOnly],
  )
}

/** Drop queued jobs for communities outside the current scope — a scope
 *  switch should not leave work in the queue that would never run. */
export async function purgeOutOfScopeJobs(adultOnly: boolean): Promise<number> {
  if (!adultOnly) return 0
  const rows = await q<{ id: string }>(
    `delete from reddit.collector_jobs j
      where j.state = 'queued'
        and not exists (select 1 from reddit.tracked_subreddits ts where ts.id = j.subreddit and ts.adult)
      returning j.id`,
  )
  return rows.length
}

export async function finishJob(id: string, state: 'done' | 'skipped' | 'failed', error?: string | null): Promise<void> {
  await sql.query(
    `update reddit.collector_jobs set state = $2, error = $3, updated_at = now() where id = $1`,
    [id, state, error ? error.slice(0, 400) : null],
  )
}

/** Hand a claimed-but-unprocessed job back to the queue (a run hit its
 *  budget mid-flight; the job must survive for the next invocation). */
export async function requeueJob(id: string): Promise<void> {
  await sql.query(
    `update reddit.collector_jobs set state = 'queued', attempts = greatest(0, attempts - 1), updated_at = now()
      where id = $1`,
    [id],
  )
}

/** Communities waiting for validation, in the order a fresh install wants
 *  them: never-validated first, then the ones that failed. Adult
 *  communities are only ever included when the admin has enabled them. */
export async function validationQueue(adultEnabled: boolean, limit: number): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id from reddit.tracked_subreddits
       where status in ('pending','error') and adult
         and not paused
         and $1::boolean
         and category = any($3::text[])
      order by case status when 'pending' then 0 else 1 end, added_at
      limit $2`,
    [adultEnabled, limit, REGISTRY_CATEGORIES],
  )
  return rows.map((row) => row.id)
}

/** Jobs left queued (a stopped run's remainder), counted for the health page. */
export async function countQueuedJobs(): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n from reddit.collector_jobs where state = 'queued'`,
  )
  return Number(row?.n ?? 0)
}

/**
 * Recovery for a process that died mid-run (a serverless timeout, a deploy,
 * a killed script): jobs stuck in `running` go back to the queue and the
 * abandoned run row is closed. Both guards are age-based, so a run that
 * another worker is genuinely executing is never stolen.
 */
export async function recoverStaleRuns(): Promise<{ runs: number; jobs: number }> {
  const runs = await q<{ id: string }>(
    `update reddit.collector_runs
        set state = 'failed', finished_at = now(),
            note = coalesce(note, 'run did not finish — process ended mid-flight')
      where state = 'running' and started_at < now() - interval '20 minutes'
      returning id`,
  )
  const jobs = await q<{ id: string }>(
    `update reddit.collector_jobs
        set state = 'queued', updated_at = now()
      where state = 'running' and updated_at < now() - interval '20 minutes'
      returning id`,
  )
  return { runs: runs.length, jobs: jobs.length }
}

/* --------------------------------------------------------------- posts */

export type PostUpsert = {
  id: string
  subreddit: string
  author: string | null
  title: string
  permalink: string | null
  url: string | null
  kind: string | null
  score: number | null
  comments: number | null
  upvote_ratio: number | null
  over18: boolean
  flair: string | null
  created_utc: string
  listing: string
  selftext_len: number | null
}

export type PostUpsertResult = { inserted: string[]; seen: string[] }

/**
 * One insert for a whole listing page. `xmax = 0` distinguishes a fresh row
 * from a conflict update, which is what "new posts today" means.
 */
export async function upsertPosts(posts: PostUpsert[]): Promise<PostUpsertResult> {
  if (!posts.length) return { inserted: [], seen: [] }
  const rows = await q<{ id: string; inserted: boolean }>(
    `insert into reddit.reddit_posts
       (id, subreddit, author, title, permalink, url, kind, score, comments,
        upvote_ratio, over18, flair, created_utc, listing, selftext_len, last_seen_at)
     select * from unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::text[], $8::int[], $9::int[], $10::real[], $11::boolean[], $12::text[],
       $13::timestamptz[], $14::text[], $15::int[], $16::timestamptz[]
     )
     on conflict (id) do update set
       score = excluded.score,
       comments = excluded.comments,
       upvote_ratio = excluded.upvote_ratio,
       last_seen_at = now()
     returning id, (xmax = 0) as inserted`,
    [
      posts.map((p) => p.id),
      posts.map((p) => p.subreddit),
      posts.map((p) => p.author),
      posts.map((p) => p.title),
      posts.map((p) => p.permalink),
      posts.map((p) => p.url),
      posts.map((p) => p.kind),
      posts.map((p) => p.score),
      posts.map((p) => p.comments),
      posts.map((p) => p.upvote_ratio),
      posts.map((p) => p.over18),
      posts.map((p) => p.flair),
      posts.map((p) => p.created_utc),
      posts.map((p) => p.listing),
      posts.map((p) => p.selftext_len),
      posts.map(() => new Date().toISOString()),
    ],
  )
  return {
    inserted: rows.filter((row) => row.inserted).map((row) => row.id),
    seen: rows.map((row) => row.id),
  }
}

export async function writePostSnapshots(
  capturedAt: string,
  posts: { id: string; score: number | null; comments: number | null }[],
): Promise<void> {
  if (!posts.length) return
  await sql.query(
    `insert into reddit.reddit_post_metric_snapshots (post_id, captured_at, score, comments)
     select * from unnest($1::text[], $2::timestamptz[], $3::int[], $4::int[])
     on conflict (post_id, captured_at) do nothing`,
    [
      posts.map((p) => p.id),
      posts.map(() => capturedAt),
      posts.map((p) => p.score),
      posts.map((p) => p.comments),
    ],
  )
}

export async function writeSubredditSnapshot(row: {
  subreddit: string
  capturedAt: string
  subscribers: number | null
  activeUsers: number | null
  postsSeen: number
  postsNew: number
  engagement: number
}): Promise<void> {
  await sql.query(
    `insert into reddit.subreddit_snapshots
       (subreddit, captured_at, subscribers, active_users, posts_seen, posts_new, engagement)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7)
     on conflict (subreddit, captured_at) do nothing`,
    [row.subreddit, row.capturedAt, row.subscribers, row.activeUsers, row.postsSeen, row.postsNew, row.engagement],
  )
}

/** When the last activity reading for a community landed — the baseline a
 *  new reading's posts_new counts forward from. Geno, 2026-10-18. */
export async function latestSubredditSnapshotAt(id: string): Promise<string | null> {
  const rows = await q<{ at: string | null }>(
    `select max(captured_at) as at from reddit.subreddit_snapshots where subreddit = $1`,
    [id],
  )
  return rows[0]?.at ?? null
}

/**
 * Posts that might have been deleted since we last saw them: recent enough
 * to matter, not confirmed gone, unseen for a day and a half. The caller
 * asks Reddit about their ids (never one request each) and calls
 * `purgePost` on the ones Reddit no longer serves.
 */
export async function reconciliationCandidates(limit: number): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id from reddit.reddit_posts
      where is_deleted = false
        and created_utc > now() - interval '7 days'
        and last_seen_at < now() - interval '36 hours'
      order by created_utc desc
      limit $1`,
    [limit],
  )
  return rows.map((row) => row.id)
}

/**
 * A post Reddit no longer serves. The row stays (its id anchors aggregate
 * history) but its content and its author's identifier go, and every read
 * path filters `is_deleted = false`, so removed content stops being served
 * through any view.
 */
export async function purgePost(id: string): Promise<void> {
  await sql.query(
    `update reddit.reddit_posts
        set is_deleted = true, removed_at = now(), author = null, title = '[removed]',
            url = null, permalink = null
      where id = $1 and is_deleted = false`,
    [id],
  )
  await sql.query(`update reddit.topic_mentions set author = null where post_id = $1`, [id])
}

/* ------------------------------------------------------------- mentions */

export type MentionUpsert = {
  topic_id: string
  post_id: string
  subreddit: string
  author: string | null
  matched: string
  weight: number
  mentioned_at: string
}

export async function recordMentions(mentions: MentionUpsert[]): Promise<number> {
  if (!mentions.length) return 0
  const rows = await q<{ id: string }>(
    `insert into reddit.topic_mentions
       (topic_id, post_id, subreddit, author, matched, weight, mentioned_at)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::real[], $7::timestamptz[])
     on conflict (topic_id, post_id) do nothing
     returning id`,
    [
      mentions.map((m) => m.topic_id),
      mentions.map((m) => m.post_id),
      mentions.map((m) => m.subreddit),
      mentions.map((m) => m.author),
      mentions.map((m) => m.matched),
      mentions.map((m) => m.weight),
      mentions.map((m) => m.mentioned_at),
    ],
  )
  return rows.length
}

/** Derived topics from adult-community titles stay in the adult-creator
 *  category. A curated topic is never replaced. */
export async function upsertDerivedTopics(phrases: { phrase: string; count: number }[]): Promise<number> {
  if (!phrases.length) return 0
  const slugs = phrases.map((p) => `derived-${p.phrase.replace(/[^a-z0-9]+/g, '-')}`)
  const rows = await q<{ id: string }>(
    `insert into reddit.topic_entities (id, name, category, keywords, source, adult, creator)
     select id, name, $3, array[name], 'derived', true, true
       from unnest($1::text[], $2::text[]) as t(id, name)
     on conflict (id) do update
       set category = excluded.category, adult = true, creator = true, updated_at = now()
     where reddit.topic_entities.source = 'derived'
     returning id`,
    [slugs, phrases.map((p) => p.phrase), TOPIC_CATEGORIES[0]],
  )
  return rows.length
}

/* -------------------------------------------------------- runs + usage */

export async function startRun(
  id: string,
  trigger: string,
  budget: number,
): Promise<void> {
  await sql.query(
    `insert into reddit.collector_runs (id, started_at, trigger, state, budget)
     values ($1, now(), $2, 'running', $3)`,
    [id, trigger, budget],
  )
}

export async function finishRun(
  id: string,
  patch: {
    state: 'done' | 'partial' | 'failed' | 'stopped'
    subreddits?: number
    requests?: number
    postsNew?: number
    postsUpdated?: number
    mentions?: number
    errors?: number
    remaining?: number | null
    note?: string | null
    detail?: Record<string, unknown>
  },
): Promise<void> {
  await sql.query(
    `update reddit.collector_runs
        set finished_at = now(), state = $2,
            subreddits = coalesce($3, subreddits), requests = coalesce($4, requests),
            posts_new = coalesce($5, posts_new), posts_updated = coalesce($6, posts_updated),
            mentions = coalesce($7, mentions), errors = coalesce($8, errors),
            remaining = $9, note = $10, detail = coalesce($11::jsonb, detail)
      where id = $1`,
    [
      id,
      patch.state,
      patch.subreddits ?? null,
      patch.requests ?? null,
      patch.postsNew ?? null,
      patch.postsUpdated ?? null,
      patch.mentions ?? null,
      patch.errors ?? null,
      patch.remaining ?? null,
      patch.note ?? null,
      patch.detail ? JSON.stringify(patch.detail) : null,
    ],
  )
}

export async function recordUsage(runId: string | null, usage: RequestUsage): Promise<void> {
  await sql.query(
    `insert into reddit.api_usage (run_id, endpoint, method, status, remaining, used, reset_at, duration_ms)
     values ($1, $2, $3, $4, $5, $6,
             case when $7::double precision is null then null else now() + ($7::double precision * interval '1 second') end,
             $8)`,
    [runId, usage.endpoint, usage.method, usage.status, usage.remaining, usage.used, usage.resetSeconds, usage.durationMs],
  )
}

/* ------------------------------------------------------------ rate safety */

/** The last rate-limit reading Reddit sent, from any run — the client seeds
 *  its pacing from this so a fresh process never starts blind. */
export async function latestRateState(): Promise<{
  remaining: number | null
  used: number | null
  resetSeconds: number | null
  at: number
} | null> {
  const [row] = await q<{ remaining: number | null; used: number | null; reset_at: string | null; at: string }>(
    `select remaining, used, reset_at, at
       from reddit.api_usage
      where remaining is not null
      order by at desc limit 1`,
  )
  if (!row) return null
  const at = Date.parse(row.at)
  return {
    remaining: row.remaining === null ? null : Number(row.remaining),
    used: row.used === null ? null : Number(row.used),
    resetSeconds: row.reset_at ? Math.max(0, (Date.parse(row.reset_at) - at) / 1000) : null,
    at,
  }
}

/** Requests made — and blocked — in the last N hours, for the rolling cap
 *  and the health page. */
export async function usageSummary(hours: number): Promise<{ requests: number; blocked: number }> {
  const [row] = await q<{ requests: number; blocked: number }>(
    `select count(*)::int as requests,
            count(*) filter (where status in (429, 403))::int as blocked
       from reddit.api_usage
      where at >= now() - ($1::int * interval '1 hour')`,
    [hours],
  )
  return { requests: Number(row?.requests ?? 0), blocked: Number(row?.blocked ?? 0) }
}

/** Requests since midnight UTC — the daily cap's counter. Every logged
 *  request counts, failures and retries included. */
export async function usageToday(): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n from reddit.api_usage where at >= date_trunc('day', now())`,
  )
  return Number(row?.n ?? 0)
}

/** When the next queued job is due, and how many are waiting. */
export async function queueState(adultOnly = false): Promise<{ nextAt: string | null; queued: number }> {
  const [row] = await q<{ next_at: string | null; queued: number }>(
    `select min(j.due_at) as next_at, count(*)::int as queued
       from reddit.collector_jobs j
      where j.state = 'queued'
        and (not $1::boolean or exists (
              select 1 from reddit.tracked_subreddits ts where ts.id = j.subreddit and ts.adult))`,
    [adultOnly],
  )
  return { nextAt: row?.next_at ?? null, queued: Number(row?.queued ?? 0) }
}

/* ------------------------------------------------------------ bulk moves */

/** One UPDATE for many communities — category, priority, pause, resume. */
export async function bulkUpdateSubreddits(ids: string[], patch: SubredditPatch): Promise<number> {
  const clean = ids.map(subredditKey).filter(Boolean).slice(0, 300)
  if (!clean.length) return 0
  const sets: string[] = []
  const params: unknown[] = [clean]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    params.push(value)
    sets.push(`${key} = $${params.length}`)
  }
  if (!sets.length) return 0
  const rows = await q<{ id: string }>(
    `update reddit.tracked_subreddits set ${sets.join(', ')}, updated_at = now()
      where id = any($1::text[]) returning id`,
    params,
  )
  return rows.length
}

/** One DELETE for many communities. Posts stay for aggregate history. */
export async function bulkDeleteSubreddits(ids: string[]): Promise<number> {
  const clean = ids.map(subredditKey).filter(Boolean).slice(0, 300)
  if (!clean.length) return 0
  const rows = await q<{ id: string }>(
    `delete from reddit.tracked_subreddits where id = any($1::text[]) returning id`,
    [clean],
  )
  return rows.length
}

/* --------------------------------------------------------------- alerts */

export async function recordAlert(alert: {
  id: string
  dedupeKey: string
  kind: string
  subject: string
  title: string
  body?: string | null
  severity?: 'info' | 'warning' | 'critical'
}): Promise<boolean> {
  const rows = await q<{ id: string }>(
    `insert into reddit.trend_alerts (id, dedupe_key, kind, subject, title, body, severity)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (dedupe_key) do nothing
     returning id`,
    [alert.id, alert.dedupeKey, alert.kind, alert.subject, alert.title, alert.body ?? null, alert.severity ?? 'info'],
  )
  return rows.length > 0
}

export async function markAlertSeen(id: string): Promise<void> {
  await sql.query(`update reddit.trend_alerts set seen_at = now() where id = $1 and seen_at is null`, [id])
}

export async function markAllAlertsSeen(): Promise<void> {
  await sql.query(`update reddit.trend_alerts set seen_at = now() where seen_at is null`)
}

/* ------------------------------------------------------------ retention */

/**
 * The periodic purge. Every step is configurable through settings and every
 * step is safe to run twice. Derived aggregates (topic metric snapshots)
 * survive as long as retention says; post bodies never existed here at all.
 */
export async function applyRetention(settings: RedditSettings): Promise<Record<string, number>> {
  const done: Record<string, number> = {}
  const count = (rows: unknown[]) => rows.length

  done.mention_authors_cleared = count(await sql.query(
    `update reddit.reddit_posts set author = null
      where author is not null and created_utc < now() - interval '30 days'
      returning id`,
  ))
  done.old_post_snapshots = count(await sql.query(
    `delete from reddit.reddit_post_metric_snapshots
      where captured_at < now() - ($1::int * interval '1 day')
      returning post_id`,
    [settings.retention_days],
  ))
  done.old_subreddit_snapshots = count(await sql.query(
    `delete from reddit.subreddit_snapshots
      where captured_at < now() - ($1::int * interval '1 day')
      returning subreddit`,
    [settings.retention_days],
  ))
  done.old_topic_snapshots = count(await sql.query(
    `delete from reddit.topic_metric_snapshots
      where captured_at < now() - ($1::int * interval '1 day')
      returning topic_id`,
    [settings.retention_days],
  ))
  done.old_posts = count(await sql.query(
    `delete from reddit.reddit_posts
      where created_utc < now() - ($1::int * interval '1 day')
      returning id`,
    [settings.retention_post_days],
  ))
  done.done_jobs = count(await sql.query(
    `delete from reddit.collector_jobs
      where state in ('done','skipped') and updated_at < now() - interval '7 days'
      returning id`,
  ))
  done.old_usage = count(await sql.query(
    `delete from reddit.api_usage where at < now() - interval '90 days' returning id`,
  ))
  done.old_runs = count(await sql.query(
    `delete from reddit.collector_runs
      where started_at < now() - ($1::int * interval '1 day')
      returning id`,
    [settings.retention_days],
  ))
  done.old_alerts = count(await sql.query(
    `delete from reddit.trend_alerts
      where created_at < now() - ($1::int * interval '1 day')
      returning id`,
    [settings.retention_days],
  ))
  return done
}

/** A registry-shaped candidate list for the admin's "replace unavailable"
 *  panel: registry candidates not currently tracked. Scoped to adult
 *  candidates when the section is adult-only, so the quick-add chips never
 *  offer a community that would not collect. */
export async function untrackedCandidates(adultOnly = false): Promise<RegistryCandidate[]> {
  const rows = await q<{ id: string }>(`select id from reddit.tracked_subreddits`)
  const tracked = new Set(rows.map((row) => row.id))
  return uniqueCandidates()
    .filter((candidate) => !tracked.has(subredditKey(candidate.name)))
    .filter((candidate) => !adultOnly || candidate.adult)
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
