-- ============================================================
-- REDDIT TRENDS — the schema that saves everything the collector reads.
--
-- A standalone copy of the statements `scripts/migrate.mjs` runs (that is
-- the source of truth; this file mirrors it for reference and for running
-- by hand in the Neon SQL editor). It has already been applied to the
-- database — running it again is safe: every statement is idempotent.
--
-- Design rules baked into the shape:
--   * Observations are stored (score, comments, mentions, subscribers).
--   * Estimates are labelled at read time, never stored as facts.
--   * Post bodies are never stored — only a length. Titles are stored but
--     cleared by the deletion reconciler when Reddit removes a post.
--   * Aggregates (topic_metric_snapshots) carry the trend history so
--     expired posts can be purged without losing the series.
-- ============================================================

create schema if not exists reddit;

-- ---------------------------------------------------------------- registry
-- One row per tracked community. `status` records what validation against
-- the authorized API actually found; nothing is guessed. Adult-facing
-- communities arrive `enabled = false` until the admin gate in Settings.
create table if not exists reddit.tracked_subreddits (
  id                  text primary key,            -- lower-cased name, no r/
  display_name        text not null,
  category            text not null,
  url                 text,
  title               text,
  description         text,
  subscribers         bigint,
  over18              boolean not null default false,
  adult               boolean not null default false,
  enabled             boolean not null default true,
  paused              boolean not null default false,
  priority            text not null default 'medium'
                        check (priority in ('high','medium','low')),
  interval_minutes    integer not null default 60,
  status              text not null default 'pending'
                        check (status in ('pending','active','unavailable','restricted','quarantined','error','disabled')),
  status_note         text,
  validated_at        timestamptz,
  last_synced_at      timestamptz,
  last_error          text,
  consecutive_failures integer not null default 0,
  source              text not null default 'seed' check (source in ('seed','manual')),
  added_at            timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists reddit_tracked_due_idx
  on reddit.tracked_subreddits (enabled, paused, priority, last_synced_at);
create index if not exists reddit_tracked_category_idx
  on reddit.tracked_subreddits (category);

-- One row per community per collection: the activity that run observed.
-- A series, because a single reading cannot show a trend.
create table if not exists reddit.subreddit_snapshots (
  subreddit      text not null,
  captured_at    timestamptz not null default now(),
  subscribers    bigint,
  active_users   bigint,
  posts_seen     integer not null default 0,
  posts_new      integer not null default 0,
  engagement     bigint not null default 0,
  primary key (subreddit, captured_at)
);
create index if not exists reddit_sub_snap_captured_idx
  on reddit.subreddit_snapshots (captured_at desc);

-- ---------------------------------------------------------------- posts
-- Deduplicated by Reddit's own id, so a re-fetch updates counts and never
-- duplicates. `selftext_len` and never `selftext`: the shape, not the body.
create table if not exists reddit.reddit_posts (
  id             text primary key,                 -- Reddit base36 id
  subreddit      text not null,
  author         text,
  title          text not null,
  permalink      text,
  url            text,
  kind           text,
  score          integer,
  comments       integer,
  upvote_ratio   real,
  over18         boolean not null default false,
  flair          text,
  created_utc    timestamptz not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  listing        text,                             -- where we first saw it
  is_deleted     boolean not null default false,
  removed_at     timestamptz,
  selftext_len   integer
);
create index if not exists reddit_posts_sub_created_idx
  on reddit.reddit_posts (subreddit, created_utc desc);
create index if not exists reddit_posts_created_idx
  on reddit.reddit_posts (created_utc desc);
create index if not exists reddit_posts_score_idx
  on reddit.reddit_posts (score desc) where is_deleted = false;

-- Score and comment count over time — what makes velocity a measured fact
-- rather than (score ÷ age) dressed up as one.
create table if not exists reddit.reddit_post_metric_snapshots (
  post_id     text not null references reddit.reddit_posts(id) on delete cascade,
  captured_at timestamptz not null,
  score       integer,
  comments    integer,
  primary key (post_id, captured_at)
);
create index if not exists reddit_post_snap_captured_idx
  on reddit.reddit_post_metric_snapshots (captured_at desc);

-- --------------------------------------------------------------- topics
-- Curated topics from the lexicon, plus recurring-bigram derivations.
create table if not exists reddit.topic_entities (
  id            text primary key,                  -- slug
  name          text not null,
  category      text not null,
  keywords      text[] not null default '{}',
  source        text not null default 'registry' check (source in ('registry','derived','manual')),
  adult         boolean not null default false,
  creator       boolean not null default false,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table reddit.topic_entities add column if not exists creator boolean not null default false;

-- One row per post per topic it matched. `matched` names the exact keyword
-- that fired, so a wrong rule can be found and fixed.
create table if not exists reddit.topic_mentions (
  id           bigserial primary key,
  topic_id     text not null references reddit.topic_entities(id) on delete cascade,
  post_id      text not null references reddit.reddit_posts(id) on delete cascade,
  subreddit    text not null,
  author       text,
  matched      text,
  weight       real not null default 1,
  mentioned_at timestamptz not null default now(),
  unique (topic_id, post_id)
);
create index if not exists reddit_mentions_topic_idx
  on reddit.topic_mentions (topic_id, mentioned_at desc);
create index if not exists reddit_mentions_post_idx
  on reddit.topic_mentions (post_id);

-- The computed trend record: observed numbers + calculated scores, one row
-- per topic per computation. `status = 'building'` is the honest state
-- before a baseline exists.
create table if not exists reddit.topic_metric_snapshots (
  topic_id      text not null references reddit.topic_entities(id) on delete cascade,
  captured_at   timestamptz not null,
  window_hours  integer not null default 24,
  mentions      integer not null default 0,
  unique_authors integer not null default 0,
  subreddits    integer not null default 0,
  engagement    bigint not null default 0,
  velocity      real,
  growth        real,
  interest      real,
  breakout      real,
  confidence    real,
  status        text not null default 'building'
                 check (status in ('breakout','rising','stable','cooling','building')),
  primary key (topic_id, captured_at, window_hours)
);
create index if not exists reddit_topic_snap_captured_idx
  on reddit.topic_metric_snapshots (captured_at desc);

-- -------------------------------------------------------------- collector
-- The work queue. Ids are derived from the community + interval bucket, so
-- two schedulers racing cannot enqueue the same slot twice.
create table if not exists reddit.collector_jobs (
  id         text primary key,
  subreddit  text not null,
  listing    text not null default 'new',
  due_at     timestamptz not null,
  priority   text not null default 'medium',
  state      text not null default 'queued'
             check (state in ('queued','running','done','skipped','failed')),
  attempts   integer not null default 0,
  error      text,
  updated_at timestamptz not null default now()
);
create index if not exists reddit_jobs_state_idx
  on reddit.collector_jobs (state, due_at);

-- One row per collection run — what it cost, what it found, how it ended.
create table if not exists reddit.collector_runs (
  id            text primary key,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  trigger       text not null default 'cron' check (trigger in ('cron','manual','validation')),
  state         text not null default 'running'
                 check (state in ('running','done','partial','failed','stopped')),
  subreddits    integer not null default 0,
  requests      integer not null default 0,
  posts_new     integer not null default 0,
  posts_updated integer not null default 0,
  mentions      integer not null default 0,
  errors        integer not null default 0,
  budget        integer not null default 0,
  remaining     integer,
  note          text,
  detail        jsonb not null default '{}'
);
create index if not exists reddit_runs_started_idx
  on reddit.collector_runs (started_at desc);

-- Every Reddit request, with the rate-limit headers Reddit actually sent.
-- Quotas are learned from these rows — never assumed from documentation.
create table if not exists reddit.api_usage (
  id          bigserial primary key,
  run_id      text,
  endpoint    text not null,
  method      text not null default 'GET',
  status      integer,
  remaining   integer,
  used        integer,
  reset_at    timestamptz,
  duration_ms integer,
  at          timestamptz not null default now()
);
create index if not exists reddit_usage_at_idx on reddit.api_usage (at desc);
create index if not exists reddit_usage_run_idx on reddit.api_usage (run_id);

-- ----------------------------------------------------------------- alerts
-- Once each by construction: `dedupe_key` carries the day.
create table if not exists reddit.trend_alerts (
  id         text primary key,
  dedupe_key text not null unique,
  kind       text not null,
  subject    text not null,
  title      text not null,
  body       text,
  severity   text not null default 'info' check (severity in ('info','warning','critical')),
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists reddit_alerts_created_idx
  on reddit.trend_alerts (created_at desc);

-- ------------------------------------------------- settings + preferences
-- Key-value so a new tuning knob does not need a migration.
create table if not exists reddit.settings (
  id         text primary key default 'global',
  values     jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- The console's own choices: saved searches, default range, density.
create table if not exists reddit.user_tracking_preferences (
  id         text primary key default 'owner',
  prefs      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
