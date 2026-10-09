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
import type { Priority, RedditSettings } from './types'

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
