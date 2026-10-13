/**
 * The requirements board's data layer: the separate subreddit registry, its
 * queue, the sampled evidence, the account-stat cache, saved lists and the
 * one optional Reddit account. The estimation math lives in
 * `requirements.ts`; this file only moves rows.
 */

import { q, sql } from '../db'
import type { RequestUsage } from './client'
import { uniqueCandidates, subredditKey } from './registry'
import type { Estimate } from './requirements'
import type {
  RequirementProfileStats,
  RequirementRow,
  RequirementSource,
  SubredditList,
} from './types'

/* ------------------------------------------------------------------ seed */

let seedPromise: Promise<number> | null = null

/** The requirements board seeds itself from the same adult-space registry
 *  the trend section uses — idempotent, memoized per process. */
export function seedRequirementSubreddits(): Promise<number> {
  seedPromise ??= seedNow().catch((error) => {
    seedPromise = null
    throw error
  })
  return seedPromise
}

async function seedNow(): Promise<number> {
  const candidates = uniqueCandidates()
  let inserted = 0
  for (const chunk of chunks(candidates, 40)) {
    const ids = chunk.map((c) => subredditKey(c.name))
    const display = chunk.map((c) => c.name.replace(/^\/?r\//i, ''))
    const category = chunk.map((c) => c.category)
    const rows = await q<{ id: string }>(
      `insert into reddit.requirement_subreddits
         (id, display_name, url, category, over18, status, source)
       select id, name, 'https://www.reddit.com/r/' || name || '/', cat, true, 'pending', 'seed'
         from unnest($1::text[], $2::text[], $3::text[]) as t(id, name, cat)
       on conflict (id) do nothing
       returning id`,
      [ids, display, category],
    )
    inserted += rows.length
  }
  return inserted
}

export async function countRequirementSubreddits(): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n from reddit.requirement_subreddits where enabled`,
  )
  return Number(row?.n ?? 0)
}

/* ------------------------------------------------------------- lifecycle */

export type RequirementDbRow = RequirementRow

export async function getRequirementSubreddit(id: string): Promise<RequirementDbRow | null> {
  const rows = await q<RequirementDbRow>(
    `select * from reddit.requirement_subreddits where id = $1`,
    [subredditKey(id)],
  )
  return rows[0] ?? null
}

export async function addRequirementSubreddit(input: {
  key: string
  display: string
  category: string
  over18?: boolean
  enabled?: boolean
}): Promise<{ ok: boolean; reason?: string }> {
  const existing = await q<{ id: string }>(
    `select id from reddit.requirement_subreddits where id = $1`,
    [input.key],
  )
  if (existing.length) return { ok: false, reason: `r/${input.display} is already on the board` }
  await sql.query(
    `insert into reddit.requirement_subreddits
       (id, display_name, url, category, over18, enabled, status, source)
     values ($1, $2, 'https://www.reddit.com/r/' || $2 || '/', $3, $4, $5, 'pending', 'manual')`,
    [input.key, input.display, input.category, Boolean(input.over18), input.enabled ?? true],
  )
  return { ok: true }
}

export type RequirementPatch = {
  category?: string
  enabled?: boolean
  priority?: 'high' | 'medium' | 'low'
  status?: string
  over18?: boolean
}

export async function updateRequirementSubreddit(id: string, patch: RequirementPatch): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = [subredditKey(id)]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    params.push(value)
    sets.push(`${key} = $${params.length}`)
  }
  if (!sets.length) return
  await sql.query(
    `update reddit.requirement_subreddits set ${sets.join(', ')}, updated_at = now() where id = $1`,
    params,
  )
}

/** Removing a community takes its evidence with it — orphaned samples would
 *  keep counting in nobody's board and in nothing's retention. */
export async function removeRequirementSubreddit(id: string): Promise<void> {
  const key = subredditKey(id)
  await sql.query(`delete from reddit.requirement_samples where subreddit = $1`, [key])
  await sql.query(`delete from reddit.requirement_jobs where subreddit = $1`, [key])
  await sql.query(`delete from reddit.requirement_subreddits where id = $1`, [key])
}

/** The row "Update" action: bring the next scan forward to the next pass. */
export async function setRequirementDueNow(id: string): Promise<void> {
  await sql.query(
    `update reddit.requirement_subreddits set next_due_at = now(), updated_at = now() where id = $1`,
    [subredditKey(id)],
  )
}

/** Set the Bot Bouncer badge. Reddit exposes no install list to app-only
 *  tokens, so this is operator knowledge — the board never invents it. */
export async function setBotBouncerStatus(
  id: string,
  status: 'yes' | 'no' | 'unknown',
  source = 'manual',
  note?: string | null,
): Promise<void> {
  await sql.query(
    `update reddit.requirement_subreddits
        set bot_bouncer = $2, bot_bouncer_source = $3, bot_bouncer_checked_at = now(),
            status_note = coalesce($4, status_note), updated_at = now()
      where id = $1`,
    [subredditKey(id), status, source, note ?? null],
  )
}

/** Save one collected pass: counts, estimates, schedule, health. The spread
 *  mirrors the trend queue's — a fleet swept in one pass comes due across
 *  hours, not in one wave, and never later than the configured interval. */
export async function markRequirementCollected(
  id: string,
  estimate: Estimate,
  postsPerDay: number | null,
  intervalMinutes: number,
): Promise<void> {
  await sql.query(
    `update reddit.requirement_subreddits
        set status = 'active', status_note = null,
            posts_per_day = coalesce($2, posts_per_day),
            sample_count = $3, survivor_count = $4, filtered_count = $5, profile_count = $6,
            min_post_karma = $7, min_comment_karma = $8, min_age_days = $9,
            avg_total_karma = $10, confirmations = $11, confidence = $12,
            first_collected_at = coalesce(first_collected_at, now()),
            last_collected_at = now(),
            next_due_at = now() + greatest(15, $13::int)
              * (0.80 + (abs(hashtext(id)) % 16)::numeric / 100) * interval '1 minute',
            consecutive_failures = 0, last_error = null, updated_at = now()
      where id = $1`,
    [
      subredditKey(id),
      postsPerDay,
      estimate.sample_count,
      estimate.survivor_count,
      estimate.filtered_count,
      estimate.profile_count,
      estimate.min_post_karma,
      estimate.min_comment_karma,
      estimate.min_age_days,
      estimate.avg_total_karma,
      estimate.confirmations,
      estimate.confidence,
      Math.max(15, intervalMinutes),
    ],
  )
}

/** A failed pass: record it, back off (failures are usually access, and
 *  retrying an unavailable community every pass is how a queue wastes a
 *  budget), and keep whatever estimates the previous passes earned. */
export async function markRequirementFailure(
  id: string,
  outcome: { status: 'unavailable' | 'restricted' | 'quarantined' | 'error'; note: string },
): Promise<void> {
  await sql.query(
    `update reddit.requirement_subreddits
        set status = $2, status_note = $3, last_error = $3,
            consecutive_failures = consecutive_failures + 1,
            next_due_at = now() + case when $2 = 'error' then interval '1 hour' else interval '7 days' end,
            updated_at = now()
      where id = $1`,
    [subredditKey(id), outcome.status, outcome.note.slice(0, 400)],
  )
}

export async function markRequirementAbout(id: string, about: {
  display_name?: string
  subscribers?: number | null
  over18?: boolean | null
}): Promise<void> {
  await sql.query(
    `update reddit.requirement_subreddits
        set status = 'active', status_note = null,
            display_name = coalesce($2, display_name),
            subscribers = coalesce($3, subscribers),
            over18 = coalesce($4, over18) or over18,
            about_at = now(),
            updated_at = now()
      where id = $1`,
    [subredditKey(id), about.display_name ?? null, about.subscribers ?? null, about.over18 ?? null],
  )
}

/* ----------------------------------------------------------------- queue */

/** One queued job per community whose next due time has arrived. The id is
 *  the due slot, so overlapping schedulers cannot double-enqueue; older
 *  queued slots for the same community are dropped, exactly like the trend
 *  queue. */
export async function enqueueDueRequirementJobs(limit = 200): Promise<number> {
  const rows = await q<{ id: string }>(
    `with due as (
       select id, coalesce(next_due_at, now() - interval '1 day') as due_at
         from reddit.requirement_subreddits
        where enabled and status in ('pending','active')
          and (next_due_at is null or next_due_at <= now())
        order by coalesce(next_due_at, now() - interval '1 day') asc
        limit $1
     )
     insert into reddit.requirement_jobs (id, subreddit, due_at, state)
     select id || ':' || floor(extract(epoch from due_at) / 60 / 15)::text,
            id, due_at, 'queued'
       from due
     on conflict (id) do nothing
     returning id`,
    [limit],
  )
  await q(
    `delete from reddit.requirement_jobs j
      where j.state = 'queued'
        and exists (
          select 1 from reddit.requirement_jobs k
           where k.subreddit = j.subreddit and k.state = 'queued'
             and (k.due_at > j.due_at or (k.due_at = j.due_at and k.id > j.id))
        )`,
  )
  return rows.length
}

export type RequirementJob = { id: string; subreddit: string }

export async function claimRequirementJobs(limit: number): Promise<RequirementJob[]> {
  return q<RequirementJob>(
    `with picked as (
       select j.id
         from reddit.requirement_jobs j
         join reddit.requirement_subreddits s on s.id = j.subreddit
        where j.state = 'queued' and j.due_at <= now()
          and s.enabled and s.status in ('pending','active')
        order by j.due_at asc
        limit $1
        for update of j skip locked
     )
     update reddit.requirement_jobs j
        set state = 'running', attempts = attempts + 1, updated_at = now()
       from picked
      where j.id = picked.id
      returning j.id, j.subreddit`,
    [limit],
  )
}

export async function finishRequirementJob(id: string, state: 'done' | 'failed', error?: string | null): Promise<void> {
  await sql.query(
    `update reddit.requirement_jobs set state = $2, error = $3, updated_at = now() where id = $1`,
    [id, state, error ? error.slice(0, 400) : null],
  )
}

export async function requeueRequirementJob(id: string): Promise<void> {
  await sql.query(
    `update reddit.requirement_jobs set state = 'queued', attempts = greatest(0, attempts - 1), updated_at = now()
      where id = $1`,
    [id],
  )
}

export async function recoverStaleRequirementWork(): Promise<{ jobs: number }> {
  const jobs = await q<{ id: string }>(
    `update reddit.requirement_jobs
        set state = 'queued', updated_at = now()
      where state = 'running' and updated_at < now() - interval '20 minutes'
      returning id`,
  )
  await q(
    `update reddit.collector_runs set state = 'failed', finished_at = now(),
            note = coalesce(note, 'requirements run did not finish — process ended mid-flight')
      where trigger = 'requirements' and state = 'running' and started_at < now() - interval '20 minutes'`,
  )
  return { jobs: jobs.length }
}

export async function countQueuedRequirementJobs(): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n from reddit.requirement_jobs where state = 'queued'`,
  )
  return Number(row?.n ?? 0)
}

/* --------------------------------------------------------------- samples */

export type SampleInsert = {
  post_id: string
  author: string | null
  permalink: string | null
  post_created_utc: string
  link_karma: number | null
  comment_karma: number | null
  account_age_days: number | null
}

/** Which of these post ids the community has already sampled — a listing
 *  re-fetch must pick *new* posts for the sample, not the same newest 25. */
export async function existingSampleIds(subreddit: string, ids: string[]): Promise<Set<string>> {
  const clean = ids.slice(0, 200)
  if (!clean.length) return new Set()
  const rows = await q<{ post_id: string }>(
    `select post_id from reddit.requirement_samples
      where subreddit = $1 and post_id = any($2::text[])`,
    [subreddit, clean],
  )
  return new Set(rows.map((row) => row.post_id))
}

/** One insert per sampled page. `on conflict do nothing` because a post is
 *  sampled once — resampling it would double its weight in the minimum. */
export async function recordRequirementSamples(subreddit: string, samples: SampleInsert[]): Promise<string[]> {
  if (!samples.length) return []
  const rows = await q<{ post_id: string }>(
    `insert into reddit.requirement_samples
       (subreddit, post_id, author, permalink, post_created_utc,
        link_karma, comment_karma, account_age_days, profile_at, outcome)
     select $1, post_id, author, permalink, created, link, comment, age,
            case when link is null and comment is null and age is null then null else now() end,
            'pending'
       from unnest($2::text[], $3::text[], $4::text[], $5::timestamptz[],
                   $6::int[], $7::int[], $8::int[])
            as t(post_id, author, permalink, created, link, comment, age)
     on conflict (subreddit, post_id) do nothing
     returning post_id`,
    [
      subreddit,
      samples.map((sample) => sample.post_id),
      samples.map((sample) => sample.author),
      samples.map((sample) => sample.permalink),
      samples.map((sample) => sample.post_created_utc),
      samples.map((sample) => sample.link_karma),
      samples.map((sample) => sample.comment_karma),
      samples.map((sample) => sample.account_age_days),
    ],
  )
  return rows.map((row) => row.post_id)
}

/** Samples old enough that AutoMod has certainly had its say, not yet judged. */
export async function samplesAwaitingJudgement(
  subreddit: string,
  limit: number,
  judgeAfterHours: number,
): Promise<{ id: number; post_id: string }[]> {
  return q<{ id: number; post_id: string }>(
    `select id, post_id from reddit.requirement_samples
      where subreddit = $1 and outcome = 'pending'
        and post_created_utc < now() - ($2::int * interval '1 hour')
      order by post_created_utc asc
      limit $3`,
    [subreddit, judgeAfterHours, limit],
  )
}

export async function applySampleOutcomes(
  rows: { id: number; outcome: string; removed_by_category: string | null }[],
): Promise<void> {
  if (!rows.length) return
  await sql.query(
    `update reddit.requirement_samples s
        set outcome = v.outcome, removed_by_category = v.category, checked_at = now()
       from unnest($1::bigint[], $2::text[], $3::text[]) as v(id, outcome, category)
      where s.id = v.id`,
    [
      rows.map((row) => row.id),
      rows.map((row) => row.outcome),
      rows.map((row) => row.removed_by_category),
    ],
  )
}

/** Authors among recent samples whose account stats we do not have (or have
 *  too old). Oldest need first — the estimator's earliest evidence is the
 *  most valuable for a stable bound. */
export async function authorsMissingProfiles(
  subreddit: string,
  limit: number,
  ttlDays: number,
): Promise<string[]> {
  const rows = await q<{ author: string }>(
    `select distinct on (lower(s.author)) s.author
       from reddit.requirement_samples s
       left join reddit.requirement_profiles p on p.username = lower(s.author)
      where s.subreddit = $1 and s.author is not null
        and (p.username is null or p.fetched_at < now() - ($2::int * interval '1 day'))
      order by lower(s.author), s.sampled_at asc
      limit $3`,
    [subreddit, ttlDays, limit],
  )
  return rows.map((row) => row.author)
}

/** Copy freshly cached stats onto that author's existing samples — a profile
 *  fetched this pass was likely missing for samples taken in earlier ones. */
export async function fillSampleProfiles(subreddit: string): Promise<number> {
  const rows = await q<{ id: string }>(
    `update reddit.requirement_samples s
        set link_karma = p.link_karma,
            comment_karma = p.comment_karma,
            account_age_days = case
              when p.created_utc is null then s.account_age_days
              else greatest(0, floor(extract(epoch from s.post_created_utc - p.created_utc) / 86400))::int end,
            profile_at = now()
       from reddit.requirement_profiles p
      where s.subreddit = $1 and lower(s.author) = p.username
        and s.author is not null
        and s.link_karma is null and p.link_karma is not null
     returning s.post_id`,
    [subreddit],
  )
  return rows.length
}

/** Everything the estimator needs for one community, newest first and
 *  bounded by the retention window. */
export async function samplesForEstimate(
  subreddit: string,
  retentionDays: number,
): Promise<{ outcome: string; link_karma: number | null; comment_karma: number | null; account_age_days: number | null }[]> {
  return q<{ outcome: string; link_karma: number | null; comment_karma: number | null; account_age_days: number | null }>(
    `select outcome, link_karma, comment_karma, account_age_days
       from reddit.requirement_samples
      where subreddit = $1 and sampled_at > now() - ($2::int * interval '1 day')
      order by sampled_at desc
      limit 600`,
    [subreddit, retentionDays],
  )
}

/** The evidence a human can open: the lowest-karma surviving posts (what
 *  holds the ceiling) and recent filtered ones (what holds the floor). */
export async function requirementSources(subreddit: string, limit = 6): Promise<RequirementSource[]> {
  return q<RequirementSource>(
    `with survivors as (
       select post_id, author, permalink, outcome, link_karma, comment_karma,
              account_age_days, post_created_utc
         from reddit.requirement_samples
        where subreddit = $1 and outcome = 'survived' and link_karma is not null
        order by link_karma asc
        limit $2
     ), filtered as (
       select post_id, author, permalink, outcome, link_karma, comment_karma,
              account_age_days, post_created_utc
         from reddit.requirement_samples
        where subreddit = $1 and outcome = 'filtered'
        order by sampled_at desc
        limit 3
     )
     select * from (
       select * from survivors union all select * from filtered
     ) evidence
     order by outcome desc, link_karma asc nulls last
     limit $2`,
    [subreddit, limit],
  )
}

/* -------------------------------------------------------------- profiles */

export async function getProfiles(usernames: string[]): Promise<Map<string, RequirementProfileStats>> {
  const clean = usernames.map((name) => name.toLowerCase()).filter(Boolean).slice(0, 200)
  if (!clean.length) return new Map()
  const rows = await q<{
    username: string; link_karma: number | null; comment_karma: number | null;
    total_karma: number | null; created_utc: string | null; over18: boolean | null; fetched_at: string
  }>(
    `select username, link_karma, comment_karma, total_karma, created_utc, over18, fetched_at
       from reddit.requirement_profiles where username = any($1::text[])`,
    [clean],
  )
  const map = new Map<string, RequirementProfileStats>()
  for (const row of rows) map.set(row.username, toProfileStats(row))
  return map
}

export async function getProfile(username: string): Promise<RequirementProfileStats | null> {
  const profiles = await getProfiles([username])
  return profiles.get(username.toLowerCase()) ?? null
}

export async function saveProfile(stats: {
  username: string
  link_karma: number | null
  comment_karma: number | null
  total_karma: number | null
  created_utc: string | null
  over18: boolean | null
  error?: string | null
}): Promise<void> {
  await sql.query(
    `insert into reddit.requirement_profiles
       (username, link_karma, comment_karma, total_karma, created_utc, over18, fetched_at, error)
     values (lower($1), $2, $3, $4, $5, $6, now(), $7)
     on conflict (username) do update
       set link_karma = excluded.link_karma,
           comment_karma = excluded.comment_karma,
           total_karma = excluded.total_karma,
           created_utc = excluded.created_utc,
           over18 = excluded.over18,
           fetched_at = now(),
           error = excluded.error`,
    [stats.username, stats.link_karma, stats.comment_karma, stats.total_karma, stats.created_utc, stats.over18, stats.error ?? null],
  )
}

export function toProfileStats(row: {
  username: string; link_karma: number | null; comment_karma: number | null;
  total_karma: number | null; created_utc: string | null; over18: boolean | null; fetched_at: string
}): RequirementProfileStats {
  const created = row.created_utc ? Date.parse(row.created_utc) : Number.NaN
  return {
    username: row.username,
    link_karma: row.link_karma === null ? null : Number(row.link_karma),
    comment_karma: row.comment_karma === null ? null : Number(row.comment_karma),
    total_karma: row.total_karma === null ? null : Number(row.total_karma),
    created_utc: row.created_utc,
    over18: row.over18,
    fetched_at: row.fetched_at,
    age_days: Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86_400_000)) : null,
  }
}

/* ------------------------------------------------------------ discovery */

export type DiscoveryState = {
  keyword_index: number
  last_run_at: string | null
  day: string | null
  checked_today: number
  added_today: number
  scanned_today: number
}

export async function getDiscoveryState(): Promise<DiscoveryState> {
  const rows = await q<DiscoveryState>(
    `select keyword_index, last_run_at, day::text as day, checked_today, added_today, scanned_today
       from reddit.discovery_state where id = 'global'`,
  )
  return rows[0] ?? { keyword_index: 0, last_run_at: null, day: null, checked_today: 0, added_today: 0, scanned_today: 0 }
}

/** Record one sweep: the cursor moves, the day's tallies roll over at
 *  midnight (database time), the run time is stamped. */
export async function saveDiscoveryRun(patch: {
  keywordIndex: number
  checked: number
  added: number
  scanned?: number
  note?: string | null
}): Promise<void> {
  await sql.query(
    `insert into reddit.discovery_state (id, keyword_index, last_run_at, day, checked_today, added_today, scanned_today, note, updated_at)
     values ('global', $1, now(), current_date, $2, $3, $4, $5, now())
     on conflict (id) do update
       set keyword_index = $1,
           last_run_at = now(),
           checked_today = case when reddit.discovery_state.day = current_date
                                then reddit.discovery_state.checked_today + $2 else $2 end,
           added_today = case when reddit.discovery_state.day = current_date
                              then reddit.discovery_state.added_today + $3 else $3 end,
           scanned_today = case when reddit.discovery_state.day = current_date
                                then reddit.discovery_state.scanned_today + $4 else $4 end,
           day = current_date,
           note = $5,
           updated_at = now()`,
    [patch.keywordIndex, patch.checked, patch.added, patch.scanned ?? 0, patch.note ?? null],
  )
}

/** Requests the discovery sweeps spent since midnight — its own 1,000/day
 *  allowance, counted from the usage log rather than a tally somebody could
 *  forget to update. */
export async function countDiscoveryRequestsToday(): Promise<number> {
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n
       from reddit.api_usage u
       join reddit.collector_runs r on r.id = u.run_id
      where r.trigger = 'discovery' and u.at >= date_trunc('day', now())`,
  )
  return Number(row?.n ?? 0)
}

/** Whether a discovery sweep is due: never run, or older than 20 hours. */
export async function discoveryDue(): Promise<boolean> {
  const [row] = await q<{ due: boolean }>(
    `select coalesce(
        (select last_run_at is null or last_run_at < now() - interval '20 hours'
           from reddit.discovery_state where id = 'global'),
        true) as due`,
  )
  return Boolean(row?.due)
}

/** Count one content scan against the day's tally, immediately — a long
 *  sweep's progress is visible while it runs and survives a crash. */
export async function addScannedProgress(count = 1): Promise<void> {
  await sql.query(
    `insert into reddit.discovery_state (id, scanned_today, day, updated_at)
     values ('global', $1, current_date, now())
     on conflict (id) do update
       set scanned_today = case when reddit.discovery_state.day = current_date
                                then reddit.discovery_state.scanned_today + $1 else $1 end,
           day = current_date,
           updated_at = now()`,
    [count],
  )
}

/** Stamp a sweep as running before its first request and after every
 *  keyword. The due-guard reads this stamp, so two schedulers can never
 *  sweep at the same time, and a long drain keeps its claim while it runs. */
export async function beginDiscoveryRun(keywordIndex: number): Promise<void> {
  await sql.query(
    `insert into reddit.discovery_state (id, keyword_index, last_run_at, day, updated_at)
     values ('global', $1, now(), current_date, now())
     on conflict (id) do update
       set keyword_index = $1, last_run_at = now(), updated_at = now()`,
    [keywordIndex],
  )
}

export type DiscoveredSubreddit = {
  name: string
  subscribers: number | null
  over18: boolean
  via: string
}

/** One insert for a sweep's finds. `on conflict do nothing` so a community
 *  already on the board keeps whatever it has earned. The search page's
 *  subscriber count is stored up front — /about will confirm it later. */
export async function insertDiscoveredSubreddits(candidates: DiscoveredSubreddit[]): Promise<string[]> {
  if (!candidates.length) return []
  const rows = await q<{ id: string }>(
    `insert into reddit.requirement_subreddits
       (id, display_name, url, category, over18, status, source, discovered_via, subscribers)
     select lower(name), name, 'https://www.reddit.com/r/' || name || '/',
            'Discovered NSFW', true, 'pending', 'discovered', via, subs
       from unnest($1::text[], $2::int[], $3::text[]) as t(name, subs, via)
     on conflict (id) do nothing
     returning id`,
    [
      candidates.map((candidate) => candidate.name),
      candidates.map((candidate) => candidate.subscribers),
      candidates.map((candidate) => candidate.via),
    ],
  )
  return rows.map((row) => row.id)
}

/** Requests the discovery sweep made today, against its settings cap. The
 *  spend is bounded by the caller; this is the reading it bounds with. */
export async function discoveryStatus(
  enabled: boolean,
  dailyCap: number,
  minSubscribers: number,
  maxCommunities: number,
  contentPercent: number,
) {
  const [state, requests] = await Promise.all([getDiscoveryState(), countDiscoveryRequestsToday()])
  return {
    enabled,
    daily_cap: dailyCap,
    requests_today: requests,
    added_today: Number(state.added_today ?? 0),
    checked_today: Number(state.checked_today ?? 0),
    scanned_today: Number(state.scanned_today ?? 0),
    last_run_at: state.last_run_at,
    min_subscribers: minSubscribers,
    max_communities: maxCommunities,
    content_percent: contentPercent,
  }
}

/* ------------------------------------------------- content scanning */

export type ContentScanTarget = {
  id: string
  display_name: string
  subscribers: number | null
}

/** The next communities due a content scan: on the board, never scanned
 *  first, then oldest scan first — a fair rotation that always prefers the
 *  communities whose topics are most stale. */
export async function communitiesDueForContentScan(limit: number): Promise<ContentScanTarget[]> {
  return q<ContentScanTarget>(
    `select id, display_name, subscribers
       from reddit.requirement_subreddits
      where enabled and status in ('pending','active')
      order by content_scanned_at asc nulls first, added_at asc
      limit $1`,
    [Math.max(1, Math.min(50, limit))],
  )
}

export async function markContentScanned(id: string, posts: number): Promise<void> {
  await sql.query(
    `update reddit.requirement_subreddits
        set content_scanned_at = now(), content_posts = $2, updated_at = now()
      where id = $1`,
    [subredditKey(id), posts],
  )
}

/** Mirror a scanned community into the trend registry so every adult-scope
 *  read (and the topic engine) sees its posts. Disabled and paused on
 *  purpose: the content sweep collects it, the trend queue must not. */
export async function syncDiscoveredSubreddit(row: {
  id: string
  display_name: string
  subscribers: number | null
}): Promise<void> {
  await sql.query(
    `insert into reddit.tracked_subreddits
       (id, display_name, category, url, subscribers, over18, adult, enabled, paused,
        priority, interval_minutes, source, status)
     values ($1, $2, 'Discovered NSFW', 'https://www.reddit.com/r/' || $2 || '/',
             $3, true, true, false, true, 'low', 1440, 'discovered', 'active')
     on conflict (id) do nothing`,
    [subredditKey(row.id), row.display_name, row.subscribers],
  )
}

/* ---------------------------------------------------------------- lists */

export async function listSubredditLists(): Promise<SubredditList[]> {
  const rows = await q<{ id: string; name: string; note: string | null; created_at: string; items: string[] | null }>(
    `select l.id, l.name, l.note, l.created_at,
            array_remove(array_agg(i.subreddit order by i.subreddit), null) as items
       from reddit.subreddit_lists l
       left join reddit.subreddit_list_items i on i.list_id = l.id
      group by l.id, l.name, l.note, l.created_at
      order by l.created_at asc`,
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    note: row.note,
    created_at: row.created_at,
    items: row.items ?? [],
  }))
}

function listId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${slug || 'list'}-${Date.now().toString(36)}`
}

export async function createSubredditList(name: string, subs: string[]): Promise<SubredditList> {
  const id = listId(name)
  await sql.query(
    `insert into reddit.subreddit_lists (id, name) values ($1, $2)`,
    [id, name.slice(0, 80)],
  )
  const clean = subs.map(subredditKey).filter(Boolean).slice(0, 500)
  if (clean.length) {
    await sql.query(
      `insert into reddit.subreddit_list_items (list_id, subreddit)
       select $1, unnest($2::text[]) on conflict do nothing`,
      [id, clean],
    )
  }
  return { id, name, note: null, created_at: new Date().toISOString(), items: clean }
}

export async function updateSubredditListItems(listId: string, add: string[], remove: string[]): Promise<number> {
  let affected = 0
  const cleanAdd = add.map(subredditKey).filter(Boolean).slice(0, 500)
  const cleanRemove = remove.map(subredditKey).filter(Boolean).slice(0, 500)
  if (cleanAdd.length) {
    const rows = await q<{ subreddit: string }>(
      `insert into reddit.subreddit_list_items (list_id, subreddit)
       select $1, unnest($2::text[]) on conflict do nothing returning subreddit`,
      [listId, cleanAdd],
    )
    affected += rows.length
  }
  if (cleanRemove.length) {
    const rows = await q<{ subreddit: string }>(
      `delete from reddit.subreddit_list_items where list_id = $1 and subreddit = any($2::text[]) returning subreddit`,
      [listId, cleanRemove],
    )
    affected += rows.length
  }
  if (affected) await sql.query(`update reddit.subreddit_lists set updated_at = now() where id = $1`, [listId])
  return affected
}

export async function deleteSubredditList(id: string): Promise<void> {
  await sql.query(`delete from reddit.subreddit_lists where id = $1`, [id])
}

/* ------------------------------------------------------------- usage log */

/** Requirement passes log their requests into the same api_usage table as
 *  everything else — the daily cap must count every request, whoever made
 *  it. Kept here (not store.ts) so the requirements module owns its writes. */
export async function recordRequirementUsage(runId: string | null, usage: RequestUsage): Promise<void> {
  await sql.query(
    `insert into reddit.api_usage (run_id, endpoint, method, status, remaining, used, reset_at, duration_ms)
     values ($1, $2, $3, $4, $5, $6,
             case when $7::double precision is null then null else now() + ($7::double precision * interval '1 second') end,
             $8)`,
    [runId, usage.endpoint, usage.method, usage.status, usage.remaining, usage.used, usage.resetSeconds, usage.durationMs],
  )
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
