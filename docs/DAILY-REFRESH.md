# Daily creator and Media Library refresh

The `scraper` Railway service deploys **`worker/` as its build root**, using
`worker/Dockerfile` and `worker/railway.json`. Deploying `cloud/` to this service
builds the wrong application and leaves the previous scraper running.

Production settings:

```text
IG_SWEEP=daily
LOOP_SEC=3600
OFMPRO_SCRAPE_ENABLED=true
```

Each daily Instagram pass refreshes the watched creators and the active model
accounts: profile/follower/story snapshots, feed/reel metadata, and post metrics.
Each creator's data is saved immediately, so an interrupted pass retains what
was already read. The persistent `/data/ig-sweep-schedule.json` prevents another
completed content pass on the same day, including after a restart. Existing
Instagram stop/cooldown rules still apply; a failed pass is reported to Discord.

Scout queues winning reels **posted in the last three days** for the Media
Library. The existing baseline and quality rules remain: at least six baseline
reels, five times the creator's own median, and at least 24 hours of settling
time. All observed posts are retained for the 120-day baseline; only the new
winner selection is limited to three days. Re-reading a post updates its
metrics without adding a duplicate library entry. The library's saved
like/comment counts refresh alongside sightings, keeping its hot ranking current.

A profile-only refresh cannot pick old content or count as a reel refresh.
`/api/scout/monitor` measures actual sighting freshness and flags content older
than 26 hours independently of profile snapshot freshness.

OFM Pro keeps its separate once-per-day metadata pull and persistent daily
marker. Pending R2 mirrors can drain on intervening worker passes. The `worker`
Railway service separately polls the cloud transcription queue every five
minutes so newly queued winners can become completed library items.

Verification:

```text
cd worker
python -m unittest test_schedule.py test_daily_refresh.py
python -m py_compile main.py ig.py schedule.py

cd ../cloud
npm test
npx tsc --noEmit
node scripts/scout-status.mjs
```

The status script needs the live `WORKER_SECRET`. If the local environment has
an old value, run it with `railway run --project <project> --environment
<environment> --service <scraper> -- node scripts/scout-status.mjs` instead.
It prints counts and freshness, never credentials or signed media links.
