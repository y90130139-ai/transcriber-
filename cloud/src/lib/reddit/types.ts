/** Shared types for the Reddit Trends feature. */

export type Priority = 'high' | 'medium' | 'low'

export type SubredditStatus =
  | 'pending'        // seeded, not yet validated against the API
  | 'active'         // validated and collectable
  | 'unavailable'    // 404 — renamed or never existed
  | 'restricted'     // 403 — private or forbidden for this app
  | 'quarantined'    // Reddit says quarantine/over-18 gate
  | 'error'          // validation failed for a transient reason
  | 'disabled'       // admin turned it off

export type TrendStatus = 'breakout' | 'rising' | 'stable' | 'cooling' | 'building'

export type TopicScore = {
  /** 0–100 against the topic's own rolling baseline, shrunk by confidence. */
  interest: number
  /** Fractional change of mention rate vs the trailing baseline window. */
  growth: number | null
  /** Engagement units per hour since the earliest mention in the window. */
  velocity: number | null
  /** 0–1 blend of growth, velocity share and community spread. */
  breakout: number | null
  /** 0–1 — how much of this reading rests on enough data. */
  confidence: number
  status: TrendStatus
}

export type TopicRow = {
  id: string
  name: string
  category: string
  adult: boolean
  creator: boolean
  mentions: number
  unique_authors: number
  subreddits: number
  engagement: number
  velocity: number | null
  growth: number | null
  interest: number | null
  breakout: number | null
  confidence: number | null
  status: TrendStatus
  captured_at: string | null
  spark: number[]
  top_subreddit: string | null
}

export type PostRow = {
  id: string
  subreddit: string
  author: string | null
  title: string
  permalink: string | null
  score: number | null
  comments: number | null
  created_utc: string
  first_seen_at: string
  over18: boolean
  flair: string | null
  velocity: number | null
  topics: string[]
}

export type SubredditRow = {
  id: string
  display_name: string
  category: string
  url: string | null
  title: string | null
  description: string | null
  subscribers: number | null
  over18: boolean
  adult: boolean
  enabled: boolean
  paused: boolean
  priority: Priority
  interval_minutes: number
  status: SubredditStatus
  status_note: string | null
  validated_at: string | null
  last_synced_at: string | null
  last_error: string | null
  consecutive_failures: number
  source: 'seed' | 'manual'
  posts_collected: number
  engagement: number
  /** New posts per day, last 14 days — the table's trend spark. */
  spark?: number[]
  /** The measured posting gates, joined from the requirements board —
   *  null until that board has sampled this community. Geno, 2026-10-18:
   *  one board instead of two, gates under the community. */
  gates?: RequirementGates | null
  /** The evidence posts behind the gates, ≤4, filtered authors first. */
  gate_sources?: RequirementSource[]
}

export type CollectorRun = {
  id: string
  started_at: string
  finished_at: string | null
  trigger: 'cron' | 'manual' | 'validation'
  state: 'running' | 'done' | 'partial' | 'failed' | 'stopped'
  subreddits: number
  requests: number
  posts_new: number
  posts_updated: number
  mentions: number
  errors: number
  budget: number
  remaining: number | null
  note: string | null
}

export type AlertRow = {
  id: string
  dedupe_key: string
  kind: string
  subject: string
  title: string
  body: string | null
  severity: 'info' | 'warning' | 'critical'
  created_at: string
  seen_at: string | null
}

/** The global settings object, in one place. Everything is optional in the
 *  database; these defaults are what the code actually runs with. */
export type RedditSettings = {
  paused: boolean
  emergency_stop: boolean
  budget_per_run: number
  min_interval_ms: number
  safety_ratio: number
  /** Rolling safety net: no more than this many Reddit requests in any
   *  clock hour, whatever the queue says. */
  hourly_cap: number
  /** Internal daily ceiling — all requests, including failures and retries.
   *  Collection stops for the rest of the day at this number. */
  daily_cap: number
  /** The normal throttle: requests per minute, a floor the client never
   *  exceeds (header pacing can only slow it further). */
  requests_per_minute: number
  /** Set when the circuit breaker trips; collection refuses to start until
   *  this passes. Null when everything is calm. */
  rate_cooldown_until: string | null
  retention_days: number
  retention_post_days: number
  high_interval_minutes: number
  medium_interval_minutes: number
  low_interval_minutes: number
  min_mentions: number
  breakout_interest: number
  breakout_growth: number
  alert_growth_pct: number
  alert_velocity: number
  alert_spread: number
  alerts_enabled: boolean
  adult_enabled: boolean
  /** Adult-only scope: the section shows — and the collector only fetches —
   *  adult communities. Always enabled for this adult-space section. */
  adult_only: boolean
  export_raw_enabled: boolean
  attestations: {
    app_registered: boolean
    oauth_scopes: boolean
    analytics_permitted: boolean
    commercial_written: boolean
    adult_authorized: boolean
  }
  /** The requirements board: its own queue, cadence and per-run budget, all
   *  spending from the same governed client and daily cap as everything
   *  else. */
  requirements_enabled: boolean
  requirements_interval_minutes: number
  requirements_budget_per_run: number
  /** Posts sampled per community per pass. */
  requirements_sample_size: number
  /** Account-stat reads per community per pass (the expensive request). */
  requirements_profile_batch: number
  /** The daily NSFW discovery sweep: its own request allowance, spent on
   *  /subreddits/search pages to find new communities and on content scans
   *  that feed the topic engine. */
  discovery_enabled: boolean
  discovery_daily_cap: number
  discovery_per_pass: number
  /** Search-result pages followed per keyword (each page is one request). */
  discovery_pages_per_keyword: number
  discovery_min_subscribers: number
  /** The stop-hunting point: once the board holds this many communities,
   *  every discovery request goes to content scanning instead. 0 = no cap. */
  discovery_max_communities: number
  /** While still hunting, the share of each sweep's budget (0–100) that
   *  goes to scanning board communities for topics and trends. */
  content_scan_percent: number
}

export type RedditPreferences = {
  range: '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | 'custom'
  from: string | null
  to: string | null
  saved_searches: { name: string; query: string; kinds: string[] }[]
  density: 'comfortable' | 'compact'
}

/* ------------------------------------------------ subreddit requirements */

export type RequirementStatus = SubredditStatus

/** How much weight the board puts on an estimate. `verified` means the same
 *  bounds held for several collection passes; `insufficient` means fewer
 *  surviving posts than the floor the estimator needs — never a made-up
 *  number. */
export type RequirementConfidence = 'verified' | 'high' | 'medium' | 'low' | 'insufficient'

export type BotBouncerStatus = 'yes' | 'no' | 'unknown'

export type RequirementRow = {
  id: string
  display_name: string
  url: string | null
  category: string
  over18: boolean
  enabled: boolean
  priority: Priority
  status: RequirementStatus
  status_note: string | null
  subscribers: number | null
  posts_per_day: number | null
  sample_count: number
  survivor_count: number
  filtered_count: number
  profile_count: number
  min_post_karma: number | null
  min_comment_karma: number | null
  min_age_days: number | null
  avg_total_karma: number | null
  confirmations: number
  confidence: RequirementConfidence
  bot_bouncer: BotBouncerStatus
  bot_bouncer_source: string | null
  bot_bouncer_checked_at: string | null
  first_collected_at: string | null
  last_collected_at: string | null
  about_at: string | null
  next_due_at: string | null
  last_error: string | null
  consecutive_failures: number
  source: 'seed' | 'manual' | 'discovered'
  discovered_via: string | null
  /** The posts that evidence the current bounds, newest first. */
  sources?: RequirementSource[]
}

/** One piece of evidence, shaped for the table's inline source list. */
export type RequirementSource = {
  post_id: string
  author: string | null
  permalink: string | null
  outcome: string
  link_karma: number | null
  comment_karma: number | null
  account_age_days: number | null
  post_created_utc: string
}

/** The measured gates for one community, as the merged board reads them. */
export type RequirementGates = {
  min_post_karma: number | null
  min_comment_karma: number | null
  min_age_days: number | null
  avg_total_karma: number | null
  posts_per_day: number | null
  confidence: RequirementConfidence
  bot_bouncer: BotBouncerStatus
  sample_count: number
  survivor_count: number
  filtered_count: number
  confirmations: number
  last_collected_at: string | null
}

export type RequirementProfileStats = {
  username: string
  link_karma: number | null
  comment_karma: number | null
  total_karma: number | null
  created_utc: string | null
  over18: boolean | null
  fetched_at: string
  age_days: number | null
}

export type SubredditList = {
  id: string
  name: string
  note: string | null
  created_at: string
  items: string[]
}

export type DiscoveryStatus = {
  enabled: boolean
  daily_cap: number
  requests_today: number
  added_today: number
  checked_today: number
  scanned_today: number
  last_run_at: string | null
  min_subscribers: number
  max_communities: number
  content_percent: number
}
