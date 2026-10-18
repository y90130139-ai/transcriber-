# Railway worker and Instagram watchdog

The Scout scrape reader no longer uses Apify. The Railway deployment consists
of two services from this repository:

1. **transcriber-worker** — the long-running queue/fallback trigger. Every five
   minutes it invokes the existing cloud worker route. Scheduler snapshots are
   refreshed every four hours through the cloud app. It also contains the daily
   profile and Friday full-sweep schedule, but Instagram scraping is disabled
   unless `ENABLE_INSTAGRAM_SCRAPING=true`.
2. **transcriber-watchdog** — a Railway cron service that calls
   `/api/scout/monitor` every two hours. It never contacts Instagram. While
   scraping is disabled it reports that state; after activation it alerts if
   profile snapshots are older than 26 hours or the last full sweep is older
   than eight days.

## Railway setup

Create two Railway services using this same repository and branch. For the
worker, use the root `railway.json`. For the watchdog service, set Railway's
configuration file path to `railway.watchdog.json`.

Set these variables on **both** services:

| Variable | Value |
|---|---|
| `CLOUD_URL` | Deployed transcriber app URL, no trailing slash |
| `WORKER_SECRET` | Same value as the app's `WORKER_SECRET` |

Set `DISCORD_WEBHOOK` on the **watchdog service** so it can post alerts itself,
including when the app health endpoint is unreachable. Set it on the worker too
if using the existing Python session-alert code. Never commit or paste the
webhook into source code. The webhook disclosed in chat must be rotated before
use; use the replacement as the environment variable value.

Attach a Railway volume mounted at `/data` to the worker service. It is needed
for cookie jars and refreshed browser state if/when scraping is enabled.

## Scheduler snapshots

The cloud app stores normalized Autoposter accounts, posts and media in
`transcriber.autoposter_snapshots`. Calendar, overview, account and composer
reads use those saved rows; successful create, approve, queue, delete and upload
actions update the local snapshot immediately. A failed refresh records its
error without replacing the last-good data.

The Railway worker calls `/api/worker/scheduler-sync` with `WORKER_SECRET`.
Snapshots refresh every four hours, in six-workspace batches so the full roster
stays within Autoposter's 60-requests-per-minute limit. Remaining batches resume
on the worker's next poll. The first Scheduler page hit also starts a due sync.
The table is created by the existing `npm run migrate` command.

## Instagram safety / cookie count

Scraping is deliberately **off by default** on Railway:

```text
ENABLE_INSTAGRAM_SCRAPING=false
```

The project notes that Railway's normal datacenter egress may be challenged by
Instagram. No number of cookie jars changes the reputation of that IP. Validate
one burner on Railway first; do not enable the production schedule until the
session survives a single profile-only probe. The reader stops on a login wall,
challenge, warning page, or HTTP 401/403/429 and does not retry that pass.

If enabling after validation, put the contents of two independent burner cookie
jar exports into Railway secret variables:

```text
SCOUT_COOKIE_JAR          # primary burner; Netscape cookie-file format
SCOUT_BACKUP_COOKIE_JAR   # separate backup account; same format
```

These are **two accounts/sessions**, not two individual cookie values. Each jar
contains several cookie fields, including `sessionid`. Do not send them in chat.
The Railway worker writes them to the mounted `/data/secrets` directory with
owner-only permissions and registers the backup for automatic rotation. The
existing browser-state JSON is kept beside each jar on the volume. Refreshing a
cookie means updating its Railway secret and redeploying the worker.

When enabled, Instagram reads retain the conservative current schedule: one
daily profile-only pass and one full Reel sweep per week, serially. The
two-hour watchdog is database-only and does not increase Instagram request
frequency. A missing daily snapshot or weekly sweep causes a Discord alert on
each watchdog run until the data is fresh again.

## Scope of the worker

The Railway worker triggers the existing cloud fallback processor. This
replaces the Mac for jobs that the hosted fallback can process, including
eligible queued Instagram reels with fresh CDN audio links. The Mac's Metal
Whisper, Apple Vision OCR, local archive, and local-media tunnel are not part of
that path; the fallback has documented feature differences in `docs/SCOUT.md`.

The worker does not fabricate a Mac heartbeat: `/api/worker/cloud` must continue
to see the old Mac heartbeat as stale so it can process work. Stop the old Mac
worker only after the Railway services and the cloud fallback have been
validated.

## Verification

After deploy:

1. Check the Railway worker logs for `Railway worker online`.
2. Run the watchdog service once manually; while scraping is disabled it should
   report stale data and send a Discord alert if `DISCORD_WEBHOOK` is set.
3. Confirm a test queue item eligible for cloud fallback is completed.
4. Keep `ENABLE_INSTAGRAM_SCRAPING=false` until the separate one-account
   egress/session validation is complete.
