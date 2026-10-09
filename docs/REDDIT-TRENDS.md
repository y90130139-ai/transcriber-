# Reddit Trends

Community intelligence for the console: a tracked registry of subreddits,
an authorized-API collector that runs independently of the UI, and a
deterministic trend engine whose every figure is labelled *observed*,
*calculated* or *estimated*. It appears in the rail under **Research →
Reddit Trends**, one item holding nine pages: Overview, Trending Now,
Topics, Posts, Subreddits, Search, Dataset, Collection Health and Settings.

All of it lives in `cloud/` (the Next.js app). The schema is a separate
`reddit` schema in the same Neon database; the collector is a scheduled
route handler; the console reads only cached database aggregates.

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `REDDIT_CLIENT_ID` | yes | Reddit app client id (app type: script or web app) |
| `REDDIT_CLIENT_SECRET` | yes | Reddit app secret — server-side only |
| `REDDIT_USER_AGENT` | no | Descriptive UA; a safe default is built from `REDDIT_CONTACT` |
| `REDDIT_CONTACT` | no | Contact string used in the default User-Agent |
| `REDDIT_REDIRECT_URI` | no | Enables the optional "connect a Reddit account" flow on the requirements board (must exactly match the redirect URI registered on the Reddit app; the app already answers both `<origin>/api/auth/reddit/callback` — what this deployment names today — and `/api/reddit/oauth?action=callback`) |

Nothing else changes. Without the credentials the collector reports
`not-configured` and the Settings page shows the setup checklist; the rest
of the section renders empty states, never fake data.

## Setup checklist (Settings → Administrator setup checklist)

Server-verifiable:

1. Reddit application registered and API access approved.
2. Credentials configured with read scope only — verified by **Test
   connection** (one token exchange, one read of a real community).

Attestations the server cannot verify, ticked by the administrator and
stored with the settings:

3. Permission for this analytics use case.
4. Written commercial-use authorization, where required.
5. Authorization for any adult/community-restricted data.

The adult gate and the raw post-metadata export are refused by the API
until their matching attestations are recorded.

## How collection runs

- **Queue.** `reddit.collector_jobs` gets one job per community due under
  its priority interval (Settings; defaults 30/60/120 min). Job ids are
  derived from the community + interval bucket, so overlapping schedulers
  cannot double-enqueue and an interrupted run resumes.
- **Budget.** Every run is capped by `budget_per_run` (default 40 requests)
  and paced by Reddit's own `x-ratelimit-*` headers at the configured
  safety ratio (default 50% of what Reddit reports). One request at a time;
  never a parallel burst.
- **Safety.** OAuth client-credentials with read scope only; descriptive
  User-Agent; Retry-After honoured by pausing subsequent requests; 5xx
  retried with jittered exponential backoff; a circuit breaker stops the
  run after three consecutive 429/403 responses; a pause switch and an
  emergency stop in Settings and on Collection Health.
- **Strategy.** `/new` always, `/hot` (and `/rising` for high priority)
  while budget allows. Posts deduplicate by Reddit id; metric snapshots
  record score/comments over time, which is what makes *velocity* measured
  rather than estimated wherever two readings exist.
- **Deletion compliance.** Recent posts unseen for 36 hours are re-checked
  in a single batched `/api/info` call; anything Reddit no longer serves is
  marked deleted, its title cleared and its author nulled, and every read
  path filters it out. Retention (Settings) then purges posts and
  aggregates on schedule. Post *bodies* are never stored — only a length.

## Scheduler

Vercel's Hobby plan only fires a daily cron, so `/api/cron/daily` runs one
collection pass per day as a floor. For the 15–60 minute cadence the brief
targets, point any frequent scheduler you already run at:

```
GET https://<app>/api/cron/reddit?k=$CRON_SECRET            # normal run
GET https://<app>/api/cron/reddit?k=$CRON_SECRET&job=validate   # queue validation
```

The collector is idempotent: running it more often only shortens staleness,
and running it less often never fabricates anything. The queue only claims a
community when its priority interval has actually elapsed, so a scheduler
can fire as often as it likes.

On this machine, collection runs without the console open:

```
npm run reddit:pull                # one pass, settings budget (40)
npm run reddit:pull -- 20          # one pass, explicit budget
npm run reddit:pull -- --test      # credentials check
npm run reddit:pull -- --validate  # validate the queue
```

and a Windows scheduled task, **"Gosian - Reddit Trends collector"**, runs
`scripts/reddit-scheduled.cmd` every 10 minutes (output in
`.reddit-pull.log`). It runs while the user is logged in; remove or inspect
it with:

```
schtasks /query  /tn "Gosian - Reddit Trends collector" /fo LIST
schtasks /delete /tn "Gosian - Reddit Trends collector" /f
```

## The monitoring scheduler (2026-10-09)

Built to scale from today's handful of communities to 1,000, within an
internal budget of **5,000 requests/day at a normal throttle of 5 req/min**
(both configurable; Reddit's own headers always win when stricter).

**The model in one line: every community has a due time; the queue is
served oldest-due first.**

- `due = last_synced + interval(priority) × activity_scale × spread(0.80–0.95)`
  — targets high 720m / medium 1440m / low 1440m: **a scan means tomorrow
  for everyone**, twice a day only for explicitly high-priority
  communities. Activity (posts seen in 24h) earns a gentle 0.9×/0.8×;
  nothing is ever due later than a day.
- The 80–95% spread is stable per community name, so a fleet synced in one
  sweep comes due across hours of the next day instead of in one wave.
- Each community's **next scan is scheduled as soon as the last one
  finishes**, with its due time in the future — the gap is visible on the
  Overview ("Next scan") and the queue shows exactly one row per
  community. Claims only ever pick what is actually due.
- FIFO on due time is the fairness guarantee: a quiet community due at
  09:00 is served before a busy one due at 09:05. The simulation suite
  (`test/reddit-schedule.test.ts`) proves it — including the starvation
  case that killed the first score-based design.
- Past ~300 communities, a fetch is one listing (`/new`); smaller fleets
  keep `/new + /hot (+ /rising)` for high priority.
- Overlapping cron runs are safe: jobs are claimed with `FOR UPDATE SKIP
  LOCKED`, enqueue is idempotent per due slot, and stale `running` rows
  from a dead process are recovered and requeued.
- Budget guards **fail closed**: if the daily/hourly counters or the rate
  state cannot be read, the run does not start (`guard-failed`). The daily
  cap is re-read **before every single request** (retries included), so
  overlapping runs cannot take the day past it.

**Projected capacity (simulated, no real requests — `npm test` prints it):**

| Metric | 1,000 communities |
| --- | --- |
| Requests / day | 1,553 of the 5,000 cap |
| Peak requests / hour | 300 (= 5/min throttle) |
| Communities uncovered in 24h | 0 |
| Time to full coverage | ~22 hours |
| Avg fetches: high / low priority | ~2.4 / ~1.2 |

**Operational risks, stated plainly.** (1) Demand sits at ~90% of the
daily cap with the default targets — the fleet has no room for a big burst
of failures; if 1,000 communities all go high-activity at once, the cap
trims extra refreshes first and daily coverage still holds (never-fetched
communities are due at the epoch and are always claimed first). (2) The
5/min throttle is the real pace — a 40-request run takes ~8 minutes, which
is why the local task fires every 10 minutes. (3) 429s pause everything for
10 minutes, a tripped breaker for 15; both are visible and clearable on
Collection Health.

## Subreddits Requirements (2026-10-10)

The tenth page: **Requirements**, under the section nav. It answers a
different question than the trend boards — *who is allowed to post where, and
with what account* — so it has its own registry, queue, cadence and tables in
the same `reddit` schema. It shares the one governed client, the pacing, the
budget guards and the daily cap; it can never spend a request the trend
collector would not have spent.

**The method, stated plainly.** Reddit does not publish karma or account-age
gates; AutoModerator enforces them privately. The board therefore *measures*
them the only way a read-only API allows:

1. Sample `/new` for the community and keep the newest posts whose authors we
   have not sampled yet (`requirements_sample_size`, default 25 per pass).
2. Read each author's stats once (`/user/<name>/about` → post karma, comment
   karma, account creation) and cache them 45 days. Account reads are the
   expensive request and are batched (`requirements_profile_batch`).
3. Judge survival later (≥6h after posting, batched `/api/info`):
   `removed_by_category = automod_filtered` → **filtered** (the author is
   below a gate); served → **survived**; anything else → removed.
4. Estimate: the *lowest* post karma / comment karma / account age seen among
   profiled **survivors** bounds the gate from above; filtered authors bound
   it from below. No profiled survivors (≥5 floor) → the column stays empty
   and the Verification chip says **No data**. Zero and unmeasured are never
   conflated.

**Verification** is stability, not a badge: the same bounds holding across
three or more passes (within 25%) earns *Verified*; 30+ survivors is
*Likely*; 15+ *Estimated*; a handful *Rough*. Every row's Source links expand
to the exact posts the bounds rest on — lowest-karma survivors first, any
AutoMod-filtered ones after — each linking to the real post.

**Bot Bouncer.** The app account (`u/bot-bouncer`) appears in a subreddit's
moderator list when installed — but Reddit refuses `/about/moderators` to
app-only tokens (403 even with `*` scope, verified live), and scraping is
off the table. The honest path is the optional **Connect Reddit account**
flow (authorization code, `read` scope, `permanent` for a refresh token;
stored server-side in `reddit.oauth_account`): the requirements pass then
reads each due community's mod list, up to 10 per pass, TTL 7 days, writing
`bot_bouncer = yes|no` with its source. No account connected → **Unknown**,
and the "With / Without Bot Bouncer" filters exclude unknowns — they never
guess. The consent URL lives in `client.ts` with the other endpoints, so the
centralized-gateway test still holds.

**The board's own controls.** u/ search reads one account and flags, per row,
whether it clears the measured bounds (pure `eligibility()` in the browser;
the reads themselves go through the governed client). r/ search filters
locally and offers to add an untracked community; adding is safe — it lands
`pending` and the next pass proves it exists. Tags come from the registry
categories. `+ New List` saves the currently shown rows as a named list
(`reddit.subreddit_lists`), reopenable from the list picker; rows can be
added/removed while a list is active; **Show All** clears every filter.

**Operations.** Settings gains the board's switches (enabled, cadence,
budget, sample size, profile batch). `collectRequirements()` runs from the
same scheduler: the cron route runs it after each trend pass
(`?job=requirements` for a board-only pass), the console's "Collect now"
runs a small manual pass, and `npm run reddit:pull` does both (flags
`--requirements` / `--no-requirements`). Runs land in `collector_runs` with
`trigger = 'requirements'`, so Collection Health shows them beside the rest.
Job claims are `FOR UPDATE SKIP LOCKED`, ids are due-slot derived, stale
`running` rows recover after 20 minutes; the daily/hourly caps and the
rate-limit circuit breaker apply exactly as they do to trends.

## The engine

Per topic over a rolling 24-hour window, from `reddit.topic_mentions`:

- **Interest index 0–100** — mention rate against the topic's own trailing
  7-day baseline, log-scaled and shrunk by confidence. 50 = its normal.
- **Growth** — rate vs baseline; `null` (shown as *new*) until a baseline
  exists. Nothing compares across topics by raw size.
- **Velocity** — observed engagement (score + comments) per hour.
- **Breakout 0–1** — 60% growth, 25% velocity share, 15% community spread,
  multiplied by confidence.
- **Confidence 0–1** — mentions × distinct authors × history depth.
- **Status** — breakout / rising / stable / cooling / building baseline.

Reddit score is upvotes, never impressions; the UI says so wherever an
engagement figure appears. Topics come from a curated lexicon
(`src/lib/reddit/keywords.ts`) plus recurring-bigram derivation.

The section is adult-space-only. The starter registry contains 20
candidates (18 unique communities) across **OnlyFans and Adult Creator
Business** and **Adult Creator Discovery and Promotion**. Topic menus and
results use **OnlyFans / Adult Creators**; older general-category records
are excluded from the boards, search and topic exports. New recurring
phrases from adult communities use the same adult-creator topic category.

## Files

| Area | Path |
| --- | --- |
| Schema + migration | `cloud/scripts/migrate.mjs` (reddit block at the end) |
| Adult-space seed (20 → 18) | `cloud/src/lib/reddit/registry.ts`, `npm run reddit:seed` |
| API client + rate limits | `cloud/src/lib/reddit/client.ts` |
| Collector | `cloud/src/lib/reddit/collect.ts` |
| Engine | `cloud/src/lib/reddit/engine.ts`, `metrics.ts` |
| Reads for pages | `cloud/src/lib/reddit/queries.ts`, `store.ts` |
| Requirements estimator (pure) | `cloud/src/lib/reddit/requirements.ts` |
| Requirements tables + queue | `cloud/src/lib/reddit/requirementStore.ts` |
| Requirements API | `cloud/src/app/api/reddit/requirements/*`, `cloud/src/app/api/reddit/lists`, `cloud/src/app/api/reddit/oauth` |
| API routes | `cloud/src/app/api/reddit/*`, `cloud/src/app/api/cron/reddit` |
| UI | `cloud/src/components/reddit/*`, `cloud/src/app/(console)/reddit-trends/*`, `cloud/src/app/reddit.css` |
| Tests | `cloud/test/reddit-*.test.ts` |

## Remaining external steps

1. Register the Reddit app and record the credentials in Vercel.
2. For the requirements board's Bot Bouncer column: make sure the Reddit
   app registers the redirect URI `REDDIT_REDIRECT_URI` names (this
   deployment: `<origin>/api/auth/reddit/callback`; the app answers it and
   `/api/reddit/oauth?action=callback` identically), then click **Connect
   Reddit account** on the Requirements page (or in Settings). Read scope
   only; without it the column honestly reads *unknown*.
3. Tick the attestations in Settings; run **Validate queue** to prove each
   community actually exists and is readable (18 starter communities, one
   request each).
4. Decide the adult-category question explicitly: the gate stays closed
   until the attestation is ticked.
5. Point a frequent scheduler at `/api/cron/reddit?k=$CRON_SECRET` for the
   sub-daily cadence (optional but recommended); each pass also advances the
   requirements board under its own budget.
