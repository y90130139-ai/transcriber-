/**
 * The collector. One entry point the cron and the console both call; it
 * works through the queue, talks to Reddit only through the governed client,
 * and is safe to run twice or to interrupt — every write is idempotent and
 * unprocessed jobs go back to the queue.
 *
 * Strategy, per the feature brief §8:
 *   - due communities only, under their own priority interval
 *   - /new always; /hot and /rising for higher priorities, budget permitting
 *   - deduplicate by Reddit post id, prefer incremental, never refetch a
 *     finished listing twice in one run
 *   - partial failures are recorded per community and never fail the run
 *   - a circuit breaker or an exhausted budget stops collection cleanly
 */

import { randomBytes } from 'node:crypto'
import {
  createRedditClient,
  classifyAboutFailure,
  redditConfigured,
  RedditAuthError,
  RedditBudgetError,
  RedditCapError,
  RedditCircuitError,
  RedditHttpError,
  RedditQuotaError,
  type RedditClient,
} from './client'
import { topicsForTitle, recurringBigrams } from './keywords'
import { alertCollector, computeTopicMetrics, detectSubredditSpikes } from './engine'
import { getSettings, saveSettings } from './settings'
import { estimateRequirements, postsPerDay, JUDGE_AFTER_HOURS, type SamplePoint } from './requirements'
import { acceptCandidate, nextKeywords, splitDiscoveryBudget } from './discovery'
import {
  addScannedProgress,
  applySampleOutcomes,
  authorsMissingProfiles,
  beginDiscoveryRun,
  claimRequirementJobs,
  communitiesDueForContentScan,
  countDiscoveryRequestsToday,
  countRequirementSubreddits,
  enqueueDueRequirementJobs,
  existingSampleIds,
  fillSampleProfiles,
  finishRequirementJob,
  getDiscoveryState,
  getProfile,
  getProfiles,
  getRequirementSubreddit,
  insertDiscoveredSubreddits,
  markContentScanned,
  markRequirementAbout,
  markRequirementCollected,
  markRequirementFailure,
  recordRequirementSamples,
  recordRequirementUsage,
  recoverStaleRequirementWork,
  requeueRequirementJob,
  samplesAwaitingJudgement,
  samplesForEstimate,
  saveDiscoveryRun,
  saveProfile,
  seedRequirementSubreddits,
  syncDiscoveredSubreddit,
  type SampleInsert,
} from './requirementStore'
import {
  applyRetention,
  claimJobs,
  countTrackedSubreddits,
  enqueueDueJobs,
  finishJob,
  finishRun,
  getSubreddit,
  latestRateState,
  listSubreddits,
  markSubredditSynced,
  markSubredditValidated,
  purgePost,
  recordMentions,
  recordUsage,
  reconciliationCandidates,
  recoverStaleRuns,
  requeueJob,
  seedRegistry,
  startRun,
  updateSubreddit,
  upsertPosts,
  upsertDerivedTopics,
  usageSummary,
  usageToday,
  writePostSnapshots,
  writeSubredditSnapshot,
  validationQueue,
  type MentionUpsert,
  type PostUpsert,
} from './store'
import type { Priority, RedditSettings, RequirementProfileStats } from './types'

const LISTINGS: Record<Priority, string[]> = {
  high: ['new', 'hot', 'rising'],
  medium: ['new', 'hot'],
  low: ['new'],
}

/** Past this many communities, a fetch is one listing — /new. The daily
 *  budget then covers every community with room for the busy ones' extra
 *  refreshes; the richer listings are a small-fleet luxury, not a right. */
const BIG_FLEET = 300

function listingsFor(priority: Priority, fleetSize: number): string[] {
  if (fleetSize > BIG_FLEET) return ['new']
  return LISTINGS[priority] ?? ['new']
}

const LISTING_LIMIT = 100
const ABOUT_REFRESH_DAYS = 7
/** Requests held back for reconciliation and the closing bookkeeping. */
const RESERVE = 2

export type RunSummary = {
  run_id: string | null
  state: 'done' | 'partial' | 'failed' | 'stopped' | 'skipped'
  reason?: string
  subreddits: number
  requests: number
  posts_new: number
  posts_updated: number
  mentions: number
  errors: number
  purged: number
  computed_topics: number
  remaining: number | null
}

export async function collect(opts: { trigger: 'cron' | 'manual' | 'validation'; budget?: number }): Promise<RunSummary> {
  const empty: RunSummary = {
    run_id: null, state: 'skipped', subreddits: 0, requests: 0, posts_new: 0,
    posts_updated: 0, mentions: 0, errors: 0, purged: 0, computed_topics: 0, remaining: null,
  }

  if (!redditConfigured()) return { ...empty, reason: 'not-configured' }
  const settings = await getSettings()
  if (settings.emergency_stop) return { ...empty, reason: 'emergency-stop' }
  if (settings.paused) return { ...empty, reason: 'paused' }

  // ---- budget guards. Everything here FAILS CLOSED: if a guard cannot be
  // read (database down, settings missing), no Reddit request is made.
  let budget = 0
  let seeded: Awaited<ReturnType<typeof latestRateState>> = null
  try {
    // After a 429 or a tripped breaker, collection stands down until the
    // cooldown passes — a scheduler hammering a blocked key is how bans
    // happen.
    if (settings.rate_cooldown_until && Date.parse(settings.rate_cooldown_until) > Date.now()) {
      return { ...empty, reason: 'rate-cooldown' }
    }
    const [hourUsage, usedToday] = await Promise.all([usageSummary(1), usageToday()])
    // The daily ceiling: every request counts, failures included, and the
    // day stops here.
    if (usedToday >= settings.daily_cap) return { ...empty, reason: 'daily-cap' }
    if (hourUsage.requests >= settings.hourly_cap) return { ...empty, reason: 'hourly-cap' }
    const headroom = Math.max(1, Math.min(
      settings.hourly_cap - hourUsage.requests,
      settings.daily_cap - usedToday,
    ))
    budget = Math.max(1, Math.min(opts.budget ?? settings.budget_per_run, headroom))
    // Seed the pacing from the last headers Reddit sent, so even a fresh
    // process resumes inside the real window instead of starting blind.
    seeded = await latestRateState()
  } catch {
    return { ...empty, reason: 'guard-failed' }
  }

  // First call on a fresh database seeds the registry — onboarding is part
  // of the collector, not a separate script somebody can forget to run.
  await seedRegistry()
  // A previous process may have died mid-run (timeout, deploy); its jobs go
  // back to the queue and its run row is closed before this one starts.
  await recoverStaleRuns().catch(() => null)

  const runId = `r_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
  await startRun(runId, opts.trigger, budget)

  const state: RunSummary = { ...empty, run_id: runId, state: 'done' }
  const client = createRedditClient({
    budget,
    minIntervalMs: settings.min_interval_ms,
    maxRequestsPerMinute: settings.requests_per_minute,
    safetyRatio: settings.safety_ratio,
    initialState: seeded,
    onUsage: (usage) => recordUsage(runId, usage),
    // Re-read the real counter before every request: overlapping runs,
    // long runs and retries can all never take the day past its cap.
    guard: async () => {
      const used = await usageToday()
      if (used >= settings.daily_cap) throw new RedditCapError(used, settings.daily_cap)
    },
  })

  try {
    if (opts.trigger === 'validation') {
      await validateQueued(client, settings, state, budget)
    } else {
      await collectDue(client, settings, state, budget, runId)
    }
  } catch (error) {
    if (error instanceof RedditCircuitError) {
      state.state = 'stopped'
      state.reason = 'circuit-breaker'
      // Stand the collector down for a quarter hour; the alert centre says so.
      await saveSettings({ rate_cooldown_until: new Date(Date.now() + 15 * 60_000).toISOString() }).catch(() => null)
    } else if (error instanceof RedditCapError) {
      state.state = 'stopped'
      state.reason = 'daily-cap'
    } else if (error instanceof RedditQuotaError) {
      state.state = 'stopped'
      state.reason = 'quota-low'
    } else if (error instanceof RedditBudgetError) {
      state.state = 'stopped'
      state.reason = 'budget-spent'
    } else if (error instanceof RedditAuthError) {
      state.state = 'failed'
      state.reason = error.message
    } else {
      state.state = 'failed'
      state.reason = error instanceof Error ? error.message : String(error)
    }
  }

  // Closing bookkeeping: topic scoring, spikes, retention, alerts. All of
  // this is database work and runs even after a stopped collection, because
  // the readings that did land are worth scoring.
  try {
    if (opts.trigger === 'validation') {
      // Validation alone does not produce post data; nothing to compute.
    } else {
      state.computed_topics = (await computeTopicMetrics()).length
      await detectSubredditSpikes()
      await applyRetention(settings)
    }
  } catch (error) {
    state.errors += 1
    state.reason = state.reason ?? `bookkeeping: ${error instanceof Error ? error.message : String(error)}`
  }

  if (state.errors >= 3) {
    try {
      await alertCollector(state.errors, `${state.errors} errors in run ${runId}`)
    } catch { /* alerting must never fail the run */ }
  }

  if (state.state === 'done' && state.errors > 0) state.state = 'partial'
  await finishRun(runId, {
    // The run has already started, so it can never be back in 'skipped'.
    state: state.state as 'done' | 'partial' | 'failed' | 'stopped',
    subreddits: state.subreddits,
    requests: state.requests,
    postsNew: state.posts_new,
    postsUpdated: state.posts_updated,
    mentions: state.mentions,
    errors: state.errors,
    remaining: state.remaining,
    note: state.reason ?? null,
    detail: { budget, purged: state.purged, computed_topics: state.computed_topics },
  })
  return state
}

/** Walk the queue until the budget is spent or the queue drains. */
async function collectDue(
  client: RedditClient,
  settings: RedditSettings,
  state: RunSummary,
  budget: number,
  runId: string,
): Promise<void> {
  await enqueueDueJobs(settings)
  const fleetSize = await countTrackedSubreddits(settings.adult_only).catch(() => 0)
  const titles: string[] = []

  // A small run (the daily cap clamping the budget down to one or two
  // requests) must still make progress — the reserve shrinks with it.
  const reserve = Math.min(RESERVE, Math.max(0, budget - 1))

  for (;;) {
    const stats = client.stats()
    state.requests = stats.requests
    state.remaining = stats.remaining
    if (stats.requests >= budget - reserve) break

    const [job] = await claimJobs(1, settings.adult_only)
    if (!job) break

    try {
      const summary = await collectOne(client, settings, job.subreddit, job.priority as Priority, titles, fleetSize)
      state.subreddits += 1
      state.posts_new += summary.postsNew
      state.posts_updated += summary.postsUpdated
      state.mentions += summary.mentions
      await finishJob(job.id, 'done')
    } catch (error) {
      if (error instanceof RedditCircuitError || error instanceof RedditAuthError
        || error instanceof RedditBudgetError || error instanceof RedditQuotaError
        || error instanceof RedditCapError) {
        // Hand the job back untouched and stop the whole run.
        await requeueJob(job.id).catch(() => null)
        throw error
      }
      state.errors += 1
      const message = error instanceof RedditHttpError
        ? `HTTP ${error.status}`
        : error instanceof Error ? error.message : String(error)
      // A single 429 is a warning shot: pause the collector for ten minutes
      // even though the run continues (the client has already adopted the
      // Retry-After window for the rest of it).
      if (error instanceof RedditHttpError && error.status === 429) {
        await saveSettings({ rate_cooldown_until: new Date(Date.now() + 10 * 60_000).toISOString() }).catch(() => null)
      }
      // A 403 on a listing is Reddit saying this endpoint/community is not
      // ours to read: quarantine the community instead of retrying into it.
      if (error instanceof RedditHttpError && error.status === 403) {
        await markSubredditValidated(job.subreddit, {
          status: 'restricted',
          note: 'Reddit denied listing access (403) — quarantined, not retried',
        }).catch(() => null)
      }
      await finishJob(job.id, 'failed', message).catch(() => null)
      await markSubredditSynced(job.subreddit, message).catch(() => null)
    }
  }

  // Reconciliation: ask about recent posts we have not seen for a day and a
  // half, in one batched /api/info call, and purge what Reddit no longer
  // serves. Budget-checked like everything else.
  if (client.stats().requests < budget - 1) {
    try {
      state.purged += await reconcile(client)
    } catch (error) {
      if (error instanceof RedditCircuitError) throw error
      state.errors += 1
    }
  }

  // Derived topics: phrases that recur enough to be a thing, kept apart from
  // the curated lexicon.
  try {
    const phrases = recurringBigrams(titles, 4, 12)
    if (phrases.length) await upsertDerivedTopics(phrases)
  } catch { /* derived topics are a bonus, never a failure */ }
}

type JobSummary = { postsNew: number; postsUpdated: number; mentions: number }

/** One community: listings → posts → snapshots → mentions. */
async function collectOne(
  client: RedditClient,
  settings: RedditSettings,
  subreddit: string,
  priority: Priority,
  titles: string[],
  fleetSize: number,
): Promise<JobSummary> {
  const tracked = await getSubreddit(subreddit)
  const summary: JobSummary = { postsNew: 0, postsUpdated: 0, mentions: 0 }
  const collectedAt = new Date()
  const capturedAt = collectedAt.toISOString()
  const seen: PostUpsert[] = []
  const seenIds = new Set<string>()

  // Refresh the community card when it is missing or stale — subscribers
  // change, and a snapshot without them is half a snapshot.
  const stale = !tracked?.validated_at ||
    (collectedAt.getTime() - Date.parse(tracked.validated_at)) > ABOUT_REFRESH_DAYS * 86_400_000
  let about = tracked
  if (stale) {
    try {
      const payload = await client.get<{ data: AboutData }>(`/r/${subreddit}/about`, { raw_json: 1 })
      await markSubredditValidated(subreddit, { status: 'active', about: mapAbout(payload.data) })
      about = await getSubreddit(subreddit)
    } catch (error) {
      if (error instanceof RedditHttpError) {
        const verdict = classifyAboutFailure(error.status, error.body)
        await markSubredditValidated(subreddit, { status: verdict.status, note: verdict.note })
        throw error
      }
      throw error
    }
  }

  for (const listing of listingsFor(priority, fleetSize)) {
    const payload = await client.get<{ data: { children: ListingChild[] } }>(
      `/r/${subreddit}/${listing}`,
      { limit: LISTING_LIMIT, raw_json: 1 },
    )
    for (const child of payload.data?.children ?? []) {
      if (child.kind !== 't3' || !child.data?.id) continue
      if (seenIds.has(child.data.id)) continue
      seenIds.add(child.data.id)
      const mapped = mapPost(child, subreddit, listing)
      seen.push(mapped)
      titles.push(mapped.title)
    }
  }

  if (seen.length) {
    const result = await upsertPosts(seen)
    summary.postsNew = result.inserted.length
    summary.postsUpdated = seen.length - summary.postsNew
    await writePostSnapshots(capturedAt, seen.map((post) => ({
      id: post.id, score: post.score, comments: post.comments,
    })))

    // Mentions are attempted for every seen post; the store's unique key
    // means a post is mentioned once, at first sighting. Mention time is the
    // moment we observed it — the window measures discovery, not authoring.
    const mentions: MentionUpsert[] = []
    for (const post of seen) {
      for (const hit of topicsForTitle(post.title)) {
        mentions.push({
          topic_id: hit.topic_id,
          post_id: post.id,
          subreddit,
          author: post.author,
          matched: hit.matched,
          weight: hit.weight,
          mentioned_at: capturedAt,
        })
      }
    }
    summary.mentions = await recordMentions(mentions)
  }

  const engagement = seen.reduce((total, post) => total + (post.score ?? 0) + (post.comments ?? 0), 0)
  await writeSubredditSnapshot({
    subreddit,
    capturedAt,
    subscribers: about?.subscribers ? Number(about.subscribers) : null,
    activeUsers: null,
    postsSeen: seen.length,
    postsNew: summary.postsNew,
    engagement,
  })
  await markSubredditSynced(subreddit, null)
  return summary
}

/** One batched existence check for possibly-deleted posts. */
async function reconcile(client: RedditClient): Promise<number> {
  const candidates = await reconciliationCandidates(25)
  if (!candidates.length) return 0
  const payload = await client.get<{ data: { children: { kind: string; data: { id: string; removed_by_category?: string | null } }[] } }>(
    '/api/info',
    { id: candidates.map((id) => `t3_${id}`).join(','), raw_json: 1 },
  )
  const alive = new Set(
    (payload.data?.children ?? [])
      .filter((child) => !child.data?.removed_by_category)
      .map((child) => child.data.id),
  )
  let purged = 0
  for (const id of candidates) {
    if (!alive.has(id)) {
      await purgePost(id)
      purged += 1
    }
  }
  return purged
}

/** Validation mode: /about for each queued community, one request each. */
async function validateQueued(
  client: RedditClient,
  settings: RedditSettings,
  state: RunSummary,
  budget: number,
): Promise<void> {
  const queue = await validationQueue(settings.adult_enabled, Math.min(40, budget - RESERVE))
  for (const id of queue) {
    if (client.stats().requests >= budget - RESERVE) break
    try {
      const payload = await client.get<{ data: AboutData }>(`/r/${id}/about`, { raw_json: 1 })
      await markSubredditValidated(id, { status: 'active', about: mapAbout(payload.data) })
      // The adult gate being open is the admin's standing decision: once a
      // community of theirs validates, it collects. Closed gate means it
      // never gets here (validationQueue excludes it).
      if (settings.adult_enabled) await updateSubreddit(id, { enabled: true })
      state.subreddits += 1
    } catch (error) {
      if (error instanceof RedditCircuitError || error instanceof RedditAuthError
        || error instanceof RedditBudgetError || error instanceof RedditQuotaError
        || error instanceof RedditCapError) throw error
      if (error instanceof RedditHttpError) {
        const verdict = classifyAboutFailure(error.status, error.body)
        await markSubredditValidated(id, { status: verdict.status, note: verdict.note })
        if (verdict.status !== 'error') state.subreddits += 1
      }
      state.errors += 1
    }
    state.requests = client.stats().requests
    state.remaining = client.stats().remaining
  }
}

export type ConnectionTest = {
  ok: boolean
  detail: string
  ms: number
  remaining: number | null
}

/**
 * The Settings page's "Test connection": one token exchange and one
 * read-only request, through the same client (and therefore the same
 * headers, pacing and bookkeeping) the collector uses. Nothing is written
 * except usage.
 */
export async function testConnection(): Promise<ConnectionTest> {
  const started = Date.now()
  if (!redditConfigured()) {
    return { ok: false, detail: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set on the server', ms: 0, remaining: null }
  }
  try {
    const settings = await getSettings()
    const client = createRedditClient({
      budget: 2,
      minIntervalMs: 0,
      guard: async () => {
        const used = await usageToday()
        if (used >= settings.daily_cap) throw new RedditCapError(used, settings.daily_cap)
      },
    })
    const target = await firstTrackedForTest()
    const payload = await client.get<{ data?: { display_name?: string } }>(`/r/${target}/about`, { raw_json: 1 })
    const name = payload.data?.display_name ?? target
    return {
      ok: true,
      detail: `Authenticated with Reddit and read r/${name} successfully`,
      ms: Date.now() - started,
      remaining: client.stats().remaining,
    }
  } catch (error) {
    const detail = error instanceof RedditAuthError
      ? `Reddit rejected the credentials: ${error.message}`
      : error instanceof Error ? error.message : String(error)
    return { ok: false, detail, ms: Date.now() - started, remaining: null }
  }
}

/** A community that exists on any Reddit: the tracked one if we have any,
 *  announcements otherwise — it is public on every deployment. */
async function firstTrackedForTest(): Promise<string> {
  const rows = await listSubreddits({ enabled: true })
  const first = rows.find((row) => row.status === 'active') ?? rows[0]
  return first ? String(first.id) : 'announcements'
}

/* --------------------------------------------------------------- mapping */

type AboutData = {
  display_name?: string
  title?: string
  public_description?: string
  subscribers?: number
  over18?: boolean
}

type ListingChild = {
  kind: string
  data?: {
    id?: string
    subreddit?: string
    author?: string
    title?: string
    permalink?: string
    url?: string
    is_self?: boolean
    is_video?: boolean
    is_gallery?: boolean
    post_hint?: string
    score?: number
    num_comments?: number
    upvote_ratio?: number
    over_18?: boolean
    link_flair_text?: string | null
    created_utc?: number
    selftext?: string
  }
}

function mapAbout(data: AboutData | undefined) {
  return {
    title: data?.title ?? data?.display_name,
    description: data?.public_description ?? undefined,
    subscribers: data?.subscribers,
    over18: data?.over18,
  }
}

/** A listing child → the row we store. Bodies are measured, never kept. */
function mapPost(child: ListingChild, subreddit: string, listing: string): PostUpsert {
  const data = child.data ?? {}
  const kind = data.is_video ? 'video'
    : data.is_gallery ? 'gallery'
    : data.is_self ? 'self'
    : data.post_hint ?? 'link'
  const author = !data.author || data.author === '[deleted]' ? null : data.author
  return {
    id: String(data.id),
    subreddit,
    author,
    title: (data.title ?? '').slice(0, 500),
    permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
    url: data.url ?? null,
    kind,
    score: typeof data.score === 'number' ? data.score : null,
    comments: typeof data.num_comments === 'number' ? data.num_comments : null,
    upvote_ratio: typeof data.upvote_ratio === 'number' ? data.upvote_ratio : null,
    over18: Boolean(data.over_18),
    flair: data.link_flair_text ?? null,
    created_utc: new Date((data.created_utc ?? 0) * 1000).toISOString(),
    listing,
    selftext_len: typeof data.selftext === 'string' ? data.selftext.length : null,
  }
}

/* ===================================================== requirements board
 *
 * The Subreddits Requirements collector. Same governed client, same guards,
 * its own queue — a separate registry with its own cadence, because the
 * board answers a different question than the trend section: not "what is
 * being said", but "who is allowed to post here, and with what account".
 *
 * The method, reversed from the reference tool's own description: sample
 * the people who recently posted, read their karma and account age, and
 * judge whether each post survived. The lowest stat among survivors bounds
 * the gate from above; AutoMod-filtered authors bound it from below. No
 * request is made outside the client, and every reading lands as a sample a
 * human can open.
 */

export type RequirementRunSummary = {
  run_id: string | null
  state: 'done' | 'partial' | 'failed' | 'stopped' | 'skipped'
  reason?: string
  subreddits: number
  requests: number
  samples_new: number
  profiles_fetched: number
  judged: number
  errors: number
  remaining: number | null
}

/** Requests held back so a run can always close its bookkeeping. */
const REQUIREMENT_RESERVE = 1
const REQUIREMENT_ABOUT_REFRESH_DAYS = 14
const REQUIREMENT_PROFILE_TTL_DAYS = 45
const REQUIREMENT_JUDGE_LIMIT = 25

export async function collectRequirements(
  opts: { trigger?: 'cron' | 'manual'; budget?: number } = {},
): Promise<RequirementRunSummary> {
  const empty: RequirementRunSummary = {
    run_id: null, state: 'skipped', subreddits: 0, requests: 0, samples_new: 0,
    profiles_fetched: 0, judged: 0, errors: 0, remaining: null,
  }

  if (!redditConfigured()) return { ...empty, reason: 'not-configured' }
  const settings = await getSettings()
  if (settings.emergency_stop) return { ...empty, reason: 'emergency-stop' }
  if (settings.paused) return { ...empty, reason: 'paused' }
  if (!settings.requirements_enabled) return { ...empty, reason: 'requirements-disabled' }

  // Budget guards — fail closed, exactly like the trend collector.
  let budget = 0
  let seeded: Awaited<ReturnType<typeof latestRateState>> = null
  try {
    if (settings.rate_cooldown_until && Date.parse(settings.rate_cooldown_until) > Date.now()) {
      return { ...empty, reason: 'rate-cooldown' }
    }
    const [hourUsage, usedToday] = await Promise.all([usageSummary(1), usageToday()])
    if (usedToday >= settings.daily_cap) return { ...empty, reason: 'daily-cap' }
    if (hourUsage.requests >= settings.hourly_cap) return { ...empty, reason: 'hourly-cap' }
    const headroom = Math.max(1, Math.min(
      settings.hourly_cap - hourUsage.requests,
      settings.daily_cap - usedToday,
    ))
    budget = Math.max(1, Math.min(opts.budget ?? settings.requirements_budget_per_run, headroom))
    seeded = await latestRateState()
  } catch {
    return { ...empty, reason: 'guard-failed' }
  }

  await seedRequirementSubreddits()
  await recoverStaleRequirementWork().catch(() => null)

  const runId = `q_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
  await startRun(runId, 'requirements', budget)

  const state: RequirementRunSummary = { ...empty, run_id: runId, state: 'done' }
  const client = createRedditClient({
    budget,
    minIntervalMs: settings.min_interval_ms,
    maxRequestsPerMinute: settings.requests_per_minute,
    safetyRatio: settings.safety_ratio,
    initialState: seeded,
    onUsage: (usage) => recordRequirementUsage(runId, usage),
    guard: async () => {
      const used = await usageToday()
      if (used >= settings.daily_cap) throw new RedditCapError(used, settings.daily_cap)
    },
  })

  try {
    await enqueueDueRequirementJobs()
    const reserve = Math.min(REQUIREMENT_RESERVE, Math.max(0, budget - 1))
    for (;;) {
      const stats = client.stats()
      state.requests = stats.requests
      state.remaining = stats.remaining
      if (stats.requests >= budget - reserve) break

      const [job] = await claimRequirementJobs(1)
      if (!job) break

      try {
        await collectRequirementOne(client, settings, job.subreddit, state)
        state.subreddits += 1
        await finishRequirementJob(job.id, 'done')
      } catch (error) {
        if (error instanceof RedditCircuitError || error instanceof RedditAuthError
          || error instanceof RedditBudgetError || error instanceof RedditQuotaError
          || error instanceof RedditCapError) {
          await requeueRequirementJob(job.id).catch(() => null)
          throw error
        }
        state.errors += 1
        const message = error instanceof RedditHttpError
          ? `HTTP ${error.status}`
          : error instanceof Error ? error.message : String(error)
        if (error instanceof RedditHttpError && error.status === 429) {
          await saveSettings({ rate_cooldown_until: new Date(Date.now() + 10 * 60_000).toISOString() }).catch(() => null)
        }
        if (error instanceof RedditHttpError) {
          const verdict = classifyAboutFailure(error.status, error.body)
          await markRequirementFailure(job.subreddit, verdict).catch(() => null)
        } else {
          await markRequirementFailure(job.subreddit, { status: 'error', note: message }).catch(() => null)
        }
        await finishRequirementJob(job.id, 'failed', message).catch(() => null)
      }
    }
  } catch (error) {
    if (error instanceof RedditCircuitError) {
      state.state = 'stopped'
      state.reason = 'circuit-breaker'
      await saveSettings({ rate_cooldown_until: new Date(Date.now() + 15 * 60_000).toISOString() }).catch(() => null)
    } else if (error instanceof RedditCapError) {
      state.state = 'stopped'
      state.reason = 'daily-cap'
    } else if (error instanceof RedditQuotaError) {
      state.state = 'stopped'
      state.reason = 'quota-low'
    } else if (error instanceof RedditBudgetError) {
      state.state = 'stopped'
      state.reason = 'budget-spent'
    } else if (error instanceof RedditAuthError) {
      state.state = 'failed'
      state.reason = error.message
    } else {
      state.state = 'failed'
      state.reason = error instanceof Error ? error.message : String(error)
    }
  }

  if (state.state === 'done' && state.errors > 0) state.state = 'partial'
  await finishRun(runId, {
    state: state.state as 'done' | 'partial' | 'failed' | 'stopped',
    subreddits: state.subreddits,
    requests: state.requests,
    mentions: 0,
    errors: state.errors,
    remaining: state.remaining,
    note: state.reason ?? null,
    detail: {
      budget,
      samples_new: state.samples_new,
      profiles_fetched: state.profiles_fetched,
      judged: state.judged,
    },
  })
  return state
}

/** One community: refresh /about when stale, judge old samples, sample new
 *  posts, fetch the missing account stats, re-estimate, reschedule. */
async function collectRequirementOne(
  client: RedditClient,
  settings: Awaited<ReturnType<typeof getSettings>>,
  subreddit: string,
  state: RequirementRunSummary,
): Promise<void> {
  const row = await getRequirementSubreddit(subreddit)
  if (!row) return

  const aboutStale = !row.about_at || (Date.now() - Date.parse(row.about_at)) > REQUIREMENT_ABOUT_REFRESH_DAYS * 86_400_000
  if (row.status !== 'active' || aboutStale) {
    const payload = await client.get<{ data: AboutData }>(`/r/${subreddit}/about`, { raw_json: 1 })
    await markRequirementAbout(subreddit, {
      display_name: payload.data?.display_name,
      subscribers: payload.data?.subscribers ?? null,
      over18: payload.data?.over18 ?? null,
    })
  }

  const sampled = await sampleNewPosts(client, settings, subreddit, state)
  state.samples_new += sampled.inserted
  // Judging after sampling means a community's newest page can both produce
  // samples and pass judgement in one pass: the posts already older than the
  // judge window are resolved before the run closes, so a FIRST pass can
  // estimate instead of every community waiting an interval for its second.
  // Anything too young for AutoMod's queue is judged on the next pass.
  await judgeSamples(client, subreddit, state)
  // A profile fetched for this pass's authors may have been missing for
  // samples taken in earlier passes; their rows get the stats now.
  await fillSampleProfiles(subreddit).catch(() => 0)
  const fresh = await getRequirementSubreddit(subreddit)
  const points: SamplePoint[] = (await samplesForEstimate(subreddit, settings.retention_days))
    .map((sample) => ({
      outcome: sample.outcome as SamplePoint['outcome'],
      link_karma: sample.link_karma === null ? null : Number(sample.link_karma),
      comment_karma: sample.comment_karma === null ? null : Number(sample.comment_karma),
      account_age_days: sample.account_age_days === null ? null : Number(sample.account_age_days),
    }))
  const estimate = estimateRequirements(points, fresh
    ? {
        min_post_karma: fresh.min_post_karma === null ? null : Number(fresh.min_post_karma),
        min_comment_karma: fresh.min_comment_karma === null ? null : Number(fresh.min_comment_karma),
        min_age_days: fresh.min_age_days === null ? null : Number(fresh.min_age_days),
        confirmations: Number(fresh.confirmations),
      }
    : null)
  await markRequirementCollected(subreddit, estimate, sampled.postsPerDay, settings.requirements_interval_minutes)
}

/** Judge samples whose posts are old enough for AutoMod to have acted. One
 *  batched /api/info call for the whole page — never one request per post. */
async function judgeSamples(
  client: RedditClient,
  subreddit: string,
  state: RequirementRunSummary,
): Promise<void> {
  const pending = await samplesAwaitingJudgement(subreddit, REQUIREMENT_JUDGE_LIMIT, JUDGE_AFTER_HOURS)
  if (!pending.length) return
  const payload = await client.get<{ data: { children: { data: { id: string; removed_by_category?: string | null } }[] } }>(
    '/api/info',
    { id: pending.map((sample) => `t3_${sample.post_id}`).join(','), raw_json: 1 },
  )
  const alive = new Map(
    (payload.data?.children ?? []).map((child) => [child.data.id, child.data.removed_by_category ?? null]),
  )
  const rows = pending.map((sample) => {
    const served = alive.has(sample.post_id)
    const category = alive.get(sample.post_id) ?? null
    const outcome = !served ? 'unavailable'
      : category === null ? 'survived'
      : category === 'automod_filtered' ? 'filtered'
      : 'removed'
    return { id: sample.id, outcome, removed_by_category: category }
  })
  await applySampleOutcomes(rows)
  state.judged += rows.length
}

/** Sample the newest posts: up to `requirements_sample_size` posts whose
 *  authors and ids we have not sampled before, plus the account stats they
 *  need. The profile reads are the expensive part and are cached by user. */
async function sampleNewPosts(
  client: RedditClient,
  settings: Awaited<ReturnType<typeof getSettings>>,
  subreddit: string,
  state: RequirementRunSummary,
): Promise<{ inserted: number; postsPerDay: number | null }> {
  const payload = await client.get<{ data: { children: ListingChild[] } }>(
    `/r/${subreddit}/new`,
    { limit: LISTING_LIMIT, raw_json: 1 },
  )
  const children = (payload.data?.children ?? []).filter(
    (child) => child.kind === 't3' && child.data?.id && child.data.author
      && child.data.author !== '[deleted]' && child.data.author !== 'AutoModerator',
  )
  const perDay = postsPerDay(
    (payload.data?.children ?? []).map((child) => child.data?.created_utc ?? 0).filter(Boolean),
  )
  if (!children.length) return { inserted: 0, postsPerDay: perDay }

  const known = await existingSampleIds(subreddit, children.map((child) => String(child.data?.id)))
  const fresh = children.filter((child) => !known.has(String(child.data?.id)))
    .slice(0, Math.max(1, settings.requirements_sample_size))
  if (!fresh.length) return { inserted: 0, postsPerDay: perDay }

  const batch = Math.max(0, settings.requirements_profile_batch)
  const fetched = new Set<string>()
  if (batch > 0) {
    const freshAuthors = [...new Set(fresh.map((child) => String(child.data?.author).toLowerCase()))]
    const cached = await getProfiles(freshAuthors)
    const missingFresh = freshAuthors.filter((author) => !cached.has(author))
    const older = missingFresh.length < batch
      ? (await authorsMissingProfiles(subreddit, batch - missingFresh.length, REQUIREMENT_PROFILE_TTL_DAYS))
        .map((author) => author.toLowerCase())
      : []
    for (const author of [...new Set([...missingFresh, ...older])].slice(0, batch)) {
      if (fetched.has(author)) continue
      fetched.add(author)
      try {
        const user = await client.get<{ data: UserAboutData }>(`/user/${author}/about`, { raw_json: 1 })
        await saveProfile(mapUserAbout(author, user.data))
        state.profiles_fetched += 1
      } catch (error) {
        // Suspended or deleted accounts are cached as a miss so the next
        // pass does not pay for the 404 again.
        await saveProfile({
          username: author,
          link_karma: null, comment_karma: null, total_karma: null,
          created_utc: null, over18: null,
          error: error instanceof RedditHttpError ? `HTTP ${error.status}` : 'fetch failed',
        }).catch(() => null)
      }
    }
  }

  const profiles = await getProfiles(fresh.map((child) => String(child.data?.author).toLowerCase()))
  const samples: SampleInsert[] = fresh.map((child) => {
    const data = child.data!
    const author = String(data.author).toLowerCase()
    const profile = profiles.get(author)
    const created = new Date((data.created_utc ?? 0) * 1000).toISOString()
    const ageDays = profile?.created_utc
      ? Math.max(0, Math.floor((Date.parse(created) - Date.parse(profile.created_utc)) / 86_400_000))
      : null
    return {
      post_id: String(data.id),
      author: author,
      permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
      post_created_utc: created,
      link_karma: profile?.link_karma ?? null,
      comment_karma: profile?.comment_karma ?? null,
      account_age_days: ageDays,
    }
  })
  const inserted = await recordRequirementSamples(subreddit, samples)
  return { inserted: inserted.length, postsPerDay: perDay }
}

/* ------------------------------------------------------ NSFW discovery */

type SubredditChild = {
  kind: string
  data?: {
    display_name?: string
    subscribers?: number
    over18?: boolean
    public_description?: string
  }
}

export type DiscoveryRunSummary = {
  run_id: string | null
  state: 'done' | 'partial' | 'failed' | 'stopped' | 'skipped'
  reason?: string
  keywords: number
  candidates: number
  added: number
  scanned: number
  posts: number
  requests: number
  errors: number
  remaining: number | null
}

/**
 * The daily sweep that hunts for new NSFW communities: `/subreddits/search`
 * pages over a rotating keyword list, filtered down to adult-facing
 * communities big enough to matter. It has its own allowance
 * (`discovery_daily_cap`, default 1,000 requests a day) — counted from the
 * usage log, so a restart cannot reset it — and every request still passes
 * the shared client's pacing and the global daily cap.
 */
export async function collectDiscovery(
  opts: { trigger?: 'cron' | 'manual'; budget?: number } = {},
): Promise<DiscoveryRunSummary> {
  const empty: DiscoveryRunSummary = {
    run_id: null, state: 'skipped', keywords: 0, candidates: 0, added: 0,
    scanned: 0, posts: 0, requests: 0, errors: 0, remaining: null,
  }

  if (!redditConfigured()) return { ...empty, reason: 'not-configured' }
  const settings = await getSettings()
  if (settings.emergency_stop) return { ...empty, reason: 'emergency-stop' }
  if (settings.paused) return { ...empty, reason: 'paused' }
  if (!settings.discovery_enabled) return { ...empty, reason: 'discovery-disabled' }

  // Budget guards — fail closed. The discovery allowance shrinks with what
  // the day has already spent, and the global caps still sit on top.
  let budget = 0
  let seeded: Awaited<ReturnType<typeof latestRateState>> = null
  try {
    if (settings.rate_cooldown_until && Date.parse(settings.rate_cooldown_until) > Date.now()) {
      return { ...empty, reason: 'rate-cooldown' }
    }
    const [hourUsage, usedToday, discoveryUsed] = await Promise.all([
      usageSummary(1),
      usageToday(),
      countDiscoveryRequestsToday(),
    ])
    if (usedToday >= settings.daily_cap) return { ...empty, reason: 'daily-cap' }
    if (hourUsage.requests >= settings.hourly_cap) return { ...empty, reason: 'hourly-cap' }
    const allowance = settings.discovery_daily_cap - discoveryUsed
    if (allowance <= 0) return { ...empty, reason: 'discovery-cap' }
    const headroom = Math.max(1, Math.min(
      settings.hourly_cap - hourUsage.requests,
      settings.daily_cap - usedToday,
    ))
    budget = Math.max(1, Math.min(opts.budget ?? settings.discovery_per_pass, allowance, headroom))
    seeded = await latestRateState()
  } catch {
    return { ...empty, reason: 'guard-failed' }
  }

  const runId = `d_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
  await startRun(runId, 'discovery', budget)

  const state: DiscoveryRunSummary = { ...empty, run_id: runId, state: 'done' }
  const client = createRedditClient({
    budget,
    minIntervalMs: settings.min_interval_ms,
    maxRequestsPerMinute: settings.requests_per_minute,
    safetyRatio: settings.safety_ratio,
    initialState: seeded,
    onUsage: (usage) => recordRequirementUsage(runId, usage),
    guard: async () => {
      const used = await usageToday()
      if (used >= settings.daily_cap) throw new RedditCapError(used, settings.daily_cap)
    },
  })

  let cursor = (await getDiscoveryState()).keyword_index
  const pagesPerKeyword = Math.min(10, Math.max(1, settings.discovery_pages_per_keyword))
  // Stamp before the first request: the due-guard reads this, so a scheduler
  // firing mid-drain cannot start a second sweep.
  await beginDiscoveryRun(cursor)
  try {
    // The budget splits between hunting and scanning; once the board reaches
    // the operator's cap, hunting stops and every request scans content.
    const boardCount = await countRequirementSubreddits()
    const split = splitDiscoveryBudget(
      budget,
      boardCount,
      settings.discovery_max_communities,
      settings.content_scan_percent,
    )
    if (split.content > 0) {
      await contentSweep(client, settings, state, split.content)
    }
    if (split.search > 0) {
      while (client.stats().requests < budget) {
        const step = nextKeywords(cursor, 1)
        const keyword = step.keywords[0]
        let after: string | null = null
        for (let page = 0; page < pagesPerKeyword && client.stats().requests < budget; page += 1) {
          const payload: { data: { children: SubredditChild[]; after?: string | null } } =
            await client.get<{ data: { children: SubredditChild[]; after?: string | null } }>(
            '/subreddits/search',
            {
              q: keyword,
              include_over_18: 'on',
              limit: LISTING_LIMIT,
              raw_json: 1,
              ...(after ? { after, count: page * LISTING_LIMIT } : {}),
            },
          )
          state.keywords += 1

          const found: { name: string; subscribers: number | null; over18: boolean; via: string }[] = []
          for (const child of payload.data?.children ?? []) {
            if (child.kind !== 't5' || !child.data?.display_name) continue
            const candidate = {
              name: child.data.display_name,
              subscribers: typeof child.data.subscribers === 'number' ? child.data.subscribers : null,
              over18: Boolean(child.data.over18),
              description: typeof child.data.public_description === 'string' ? child.data.public_description : null,
            }
            if (!acceptCandidate(candidate, settings.discovery_min_subscribers)) continue
            found.push({ name: candidate.name, subscribers: candidate.subscribers, over18: candidate.over18, via: keyword })
          }
          state.candidates += found.length
          if (found.length) state.added += (await insertDiscoveredSubreddits(found.slice(0, 200))).length

          after = payload.data?.after ?? null
          if (!after) break
        }
        cursor = step.nextCursor
        // Progress stamp: the cursor survives a crash and the claim stays held.
        await beginDiscoveryRun(cursor)
      }
    }
  } catch (error) {
    if (error instanceof RedditCircuitError) {
      state.state = 'stopped'
      state.reason = 'circuit-breaker'
      await saveSettings({ rate_cooldown_until: new Date(Date.now() + 15 * 60_000).toISOString() }).catch(() => null)
    } else if (error instanceof RedditCapError) {
      state.state = 'stopped'
      state.reason = 'daily-cap'
    } else if (error instanceof RedditQuotaError) {
      state.state = 'stopped'
      state.reason = 'quota-low'
    } else if (error instanceof RedditBudgetError) {
      state.state = 'done'
    } else if (error instanceof RedditAuthError) {
      state.state = 'failed'
      state.reason = error.message
    } else {
      state.state = 'failed'
      state.reason = error instanceof Error ? error.message : String(error)
    }
  }

  state.requests = client.stats().requests
  state.remaining = client.stats().remaining
  if (state.state === 'done' && state.errors > 0) state.state = 'partial'
  await saveDiscoveryRun({
    keywordIndex: cursor,
    checked: state.requests,
    added: state.added,
    // Scans were already counted one by one (addScannedProgress); passing 0
    // keeps the day's tally from double-counting this pass.
    scanned: 0,
    note: state.reason ?? null,
  }).catch(() => null)
  await finishRun(runId, {
    state: state.state === 'skipped' ? 'done' : state.state,
    requests: state.requests,
    mentions: 0,
    errors: state.errors,
    remaining: state.remaining,
    note: state.reason ?? null,
    detail: {
      budget, keywords: state.keywords, candidates: state.candidates,
      added: state.added, scanned: state.scanned, posts: state.posts,
    },
  })
  return state
}

/**
 * The content phase: scan board communities' /new pages so their posts feed
 * the topic engine (and, through it, Topics and Trending Now). Each scanned
 * community is mirrored into the trend registry as a disabled row — the
 * adult-scope reads and the engine see it; the trend queue does not.
 */
async function contentSweep(
  client: RedditClient,
  settings: Awaited<ReturnType<typeof getSettings>>,
  state: DiscoveryRunSummary,
  contentBudget: number,
): Promise<void> {
  const titles: string[] = []
  while (client.stats().requests < contentBudget) {
    const remaining = contentBudget - client.stats().requests
    const targets = await communitiesDueForContentScan(Math.min(8, remaining))
    if (!targets.length) break

    for (const target of targets) {
      if (client.stats().requests >= contentBudget) break
      try {
        const payload = await client.get<{ data: { children: ListingChild[] } }>(
          `/r/${target.id}/new`,
          { limit: LISTING_LIMIT, raw_json: 1 },
        )
        const seen: PostUpsert[] = []
        const seenIds = new Set<string>()
        for (const child of payload.data?.children ?? []) {
          if (child.kind !== 't3' || !child.data?.id || seenIds.has(child.data.id)) continue
          seenIds.add(child.data.id)
          const mapped = mapPost(child, target.id, 'new')
          seen.push(mapped)
          titles.push(mapped.title)
        }

        const capturedAt = new Date().toISOString()
        if (seen.length) {
          const result = await upsertPosts(seen)
          await writePostSnapshots(capturedAt, seen.map((post) => ({
            id: post.id, score: post.score, comments: post.comments,
          })))
          const mentions: MentionUpsert[] = []
          for (const post of seen) {
            for (const hit of topicsForTitle(post.title)) {
              mentions.push({
                topic_id: hit.topic_id,
                post_id: post.id,
                subreddit: target.id,
                author: post.author,
                matched: hit.matched,
                weight: hit.weight,
                mentioned_at: capturedAt,
              })
            }
          }
          await recordMentions(mentions)
          state.posts += seen.length
          await writeSubredditSnapshot({
            subreddit: target.id,
            capturedAt,
            subscribers: target.subscribers,
            activeUsers: null,
            postsSeen: seen.length,
            postsNew: result.inserted.length,
            engagement: seen.reduce((total, post) => total + (post.score ?? 0) + (post.comments ?? 0), 0),
          }).catch(() => null)
        }

        await syncDiscoveredSubreddit(target)
        await markContentScanned(target.id, seen.length)
        state.scanned += 1
        // The day's tally moves with every scan, not just at pass end.
        await addScannedProgress(1).catch(() => null)
      } catch (error) {
        if (error instanceof RedditCircuitError || error instanceof RedditAuthError
          || error instanceof RedditBudgetError || error instanceof RedditQuotaError
          || error instanceof RedditCapError) {
          throw error
        }
        state.errors += 1
        if (error instanceof RedditHttpError) {
          const verdict = classifyAboutFailure(error.status, error.body)
          await markRequirementFailure(target.id, verdict).catch(() => null)
        }
      }
    }
  }

  // Derived topics and the trend maths, once per sweep that scanned
  // anything — the same bookkeeping the trend collector runs.
  if (state.scanned > 0) {
    try {
      const phrases = recurringBigrams(titles, 4, 12)
      if (phrases.length) await upsertDerivedTopics(phrases)
      await computeTopicMetrics()
      await detectSubredditSpikes()
    } catch {
      // Bookkeeping must never fail a sweep; the readings that landed are
      // still worth keeping.
    }
  }
}

/* ------------------------------------------------------ profile lookup */

type UserAboutData = {
  link_karma?: number
  comment_karma?: number
  total_karma?: number
  created_utc?: number
  over_18?: boolean
}

function mapUserAbout(username: string, data: UserAboutData | undefined) {
  return {
    username,
    link_karma: typeof data?.link_karma === 'number' ? data.link_karma : null,
    comment_karma: typeof data?.comment_karma === 'number' ? data.comment_karma : null,
    total_karma: typeof data?.total_karma === 'number' ? data.total_karma : null,
    created_utc: typeof data?.created_utc === 'number' ? new Date(data.created_utc * 1000).toISOString() : null,
    over18: typeof data?.over_18 === 'boolean' ? data.over_18 : null,
  }
}

/**
 * The username search's one network call: read an account's karma and age
 * through the same governed client, cache it, and answer from cache for six
 * hours. This is what lets the board say "this account would clear r/x's
 * gate" without guessing.
 */
export async function fetchRequirementProfile(username: string): Promise<RequirementProfileStats | null> {
  const clean = username.trim().replace(/^\/?u\//i, '').replace(/[^A-Za-z0-9_-]/g, '').toLowerCase()
  if (!clean) return null
  const cached = await getProfile(clean)
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 6 * 3_600_000) return cached
  if (!redditConfigured()) return cached
  try {
    const settings = await getSettings()
    const client = createRedditClient({
      budget: 2,
      minIntervalMs: 0,
      onUsage: (usage) => recordRequirementUsage(null, usage),
      guard: async () => {
        const used = await usageToday()
        if (used >= settings.daily_cap) throw new RedditCapError(used, settings.daily_cap)
      },
    })
    const payload = await client.get<{ data: UserAboutData }>(`/user/${clean}/about`, { raw_json: 1 })
    await saveProfile(mapUserAbout(clean, payload.data))
  } catch {
    // Keep whatever was cached — a stale reading beats an error in the UI.
  }
  return getProfile(clean)
}
