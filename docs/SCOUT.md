# Scout — the weekly watchlist sweep

> **Current deployment:** this document's original Mac/Apify split is historical.
> Apify is removed from the active code. Railway owns the queue trigger and
> two-hour freshness watchdog; Instagram scraping stays disabled there until a
> single burner session is validated on Railway egress. See
> [RAILWAY-MIGRATION.md](RAILWAY-MIGRATION.md) and
> [SCOUT-SETUP.md](SCOUT-SETUP.md) for current setup and cookie requirements.

Built 2026-09-19 on branch `feat/scout`. This is stage 1 of the loop in
`docs/GAME-PLAN.md` — **ingest** — the one piece that was still manual: every
one of the 465 library items to date was a hand-pasted Instagram link, 208 of
them in the week before this was built.

## What it does

Every Saturday at 10:00 (`com.geno.social-transcriber.scout`, launchd, no
RunAtLoad) `bin/scout`:

1. asks the app who is watched (`POST /api/scout/targets`);
2. lists each creator's recent reels, **metadata only** — plays, likes,
   comments, audio, collaborators, tagged accounts;
   - open accounts → Apify `apify/instagram-reel-scraper`, logged out, under a
     hard `maxTotalChargeUsd` per run;
   - gated accounts → a **throwaway** signed-in Instagram session on the Mac;
3. posts every sighting back (`POST /api/scout/ingest`, chunks of 500).

The app keeps every sighting in `transcriber.sightings`, measures each reel
against **its own creator's median plays**, and queues the winners into the
ordinary `jobs` queue with the same `source_key` dedupe a paste uses. The
worker then fetches, transcribes, OCRs and tags them, and Sunday's 17:00
auto-draft can put them on a week. Queue rows read
`scout · 3.4× @handle's median plays`.

It also writes the collaborators and tagged accounts on each winner into
`creators` as `watch = 'suggested'` — never swept, never charged for — and
collects audio so `GET /api/scout/sounds` can list sounds two or more watched
creators picked up in the last fortnight.

## Why this design and not the vidIQ teardown's

`~/Desktop/gosian_vidIQ_Teardown copy.docx` recommended the vidIQ MCP server as
the data layer. Checked against vidIQ's own help centre and terms 2026-09-19:

- **"Private accounts and age-restricted accounts are not supported."** Half
  of this watchlist is gated (below). vidIQ cannot see it at all.
- Terms §5(t) forbid use "for any revenue-generating endeavor or commercial
  enterprise"; §5(q)/(y) forbid automated use; §5(l) forbids compiling a
  database from it. An agency pipeline is all four.
- TikTok is "not yet"; its outlier score is likes-based, not plays; tool names
  in the doc appear in no public vidIQ source.

The doc also over-credited what vidIQ would replace: the per-creator "normal"
(`hot.ts`), tagging (`autotag.ts`) and direction drafting (`brief.ts`,
`script.ts`) were already automatic. The real gap was intake, and a raw feed
fixes it better than pre-chewed outliers because it gives **every** post — the
thing `hot.ts` never had.

## Facts measured, not assumed

- **Gated share: 97 of 194** creators (one reel each, fetched anonymously with
  the vendored yt-dlp, 2026-09-19): 36 "can't be seen by certain audiences",
  61 "empty media response". Hence the burner.
- **40% of the library could never earn 🔥**: 142 of 194 creators had one
  kept post, and `hot.ts` needs three. Sightings give every creator a baseline.
- **45 of 196 creators were filed under display names**, not handles — a bug in
  `_pick_handle` (Instagram puts the handle in `channel`). Fixed in
  `src/media.py`; `cloud/scripts/fix-handles.mjs` re-filed 92 rows. Rollback
  record in `docs/rollback/fix-handles.*.json`. A sweep keyed on "Amelia" would
  have silently skipped her.
- Apify reel scraper, from its own API: $0.0026/reel on Free, $0.0023 on
  Starter; 146k users; 99.8% of 3.3M runs succeeded over 30 days; rebuilt
  2026-09-16. Restricted accounts return an error row and cost nothing.
- vendored yt-dlp 2026.08.19 is the latest release and `instagram:user` is
  still `CURRENTLY BROKEN` — there is no free logged-out lister to wait for.

## The pick rule (all in `cloud/src/lib/scout.ts`)

| Constant | Value | Why |
|---|---|---|
| `PICK_MULTIPLIER` | 2.0× | **Provisional.** Re-set to about the top decile from the first real sweep's spread (printed by `bin/scout` and stored in `scout_runs.notes.spread`) — the same way `HOT_THRESHOLD` was set. |
| `MIN_BASELINE_REELS` | 6 | fewer and "her median" is noise |
| `BASELINE_DAYS` | 120 | steady, but measures who she is now |
| `PICK_WINDOW_DAYS` / `SETTLE_HOURS` | 14 / 24 | recent enough to make now; a 2-hour-old reel at 3× has only reached her core |
| `MAX_PICKS_PER_CREATOR` / `_PER_RUN` | 3 / 80 | one hot creator must not become the library; one sweep must not bury the Mac |

Plays when the creator has six reels with plays; otherwise likes + 10 ×
comments, the weight `hot.ts` already uses. Pinned reels never count — they
are old and would drag the baseline.

**`hot.ts` is deliberately unchanged.** NEXT-INGEST's rule: changing the score
and adding its input in the same step makes both unmeasurable. Once a few
weeks of sightings exist, the next step is letting `hot.ts` take its median
from sightings too.

## Setup — two things only Geno can do

### 1. Apify token (open accounts)

1. Sign up at apify.com (free plan: $5 of usage a month, no card).
2. Settings → API & Integrations → copy the personal API token.
3. Put it in `config.json` → `scout.apify_token`.
4. First run, on the free credit: `./bin/scout --only apify --limit 40`
   (~40 accounts × ≤30 reels ≈ $3). Read the spread it prints.
5. Full weekly sweep needs the **$19/mo Starter** plan (price checked on
   apify.com/pricing 2026-09-19; it includes that much usage). First backfill
   of ~100 open accounts ≈ $7; the weekly refresh after that ≈ $4 (~1,700
   reels × $0.0023), so ~$17 a month fits inside the plan. Raise
   `scout.max_usd_per_run` to ~8 when on Starter.

### 2. Burner session (gated accounts)

1. A **new** Instagram account, made only for this. Never Geno's, never a
   model's. Adult birthday (21+, some accounts gate at 21).
2. Use it like a person for 2–3 days first — follow ~20 of the watched
   accounts, scroll. A brand-new account that only makes API calls is the
   fastest way to a checkpoint.
3. In a **separate Chrome profile** signed into only the burner, export
   instagram.com cookies with "Get cookies.txt LOCALLY" to
   `secrets/scout-cookies.txt`. (Separate profile: exporting from the main
   profile would hand over Geno's session. The agent cannot read Chrome's
   cookie store — this step is by hand, same as `secrets/cookies.txt`.)
4. `./bin/scout --check-burner <a gated handle>` — prints her last reels with
   plays. Then `./bin/scout --only burner --limit 10`.

If the burner is ever challenged, the pass stops at that account, posts what
it read, and logs `burner stopped: …`. Re-sign-in, re-export, carry on.

## Operating it

- Log: `~/Library/Logs/social-transcriber-scout.log`.
- Run history: `select * from transcriber.scout_runs order by started_at desc`.
- By hand at any time: `./bin/scout` (safe — dedupe makes a re-run free of
  duplicates; it costs one more sweep).
- `--dry` shows the plan and fetches nothing.

## Next, in order

1. **Calibrate `PICK_MULTIPLIER`** from the first full sweep's spread. In the
   same pass, check which play figure the actor actually fills
   (`igPlayCount` vs `videoPlayCount`). They differ only for reels cross-posted
   to Facebook, but the mapper falls back per reel, so if `igPlayCount` turns
   out to be patchy, pin one field for everybody rather than mixing them
   (code review, 2026-09-19).
2. **Surface it in the UI** — a "Suggested" list on Creators (Watch / Dismiss)
   and a "Sounds rising" panel from `/api/scout/sounds`. The data is already
   being collected.
3. **Sweep our own models' accounts** — the same reader gives plays on *her*
   posts, which is stage 7 (measure) for every non-gated model *without* the
   Meta app. It does not replace Insights (no saves, no watch time) but it
   answers "did the replication beat her median" months sooner.
4. **`hot.ts` baseline from sightings** once there are a few weeks of them.
5. **TikTok radar (phase 2, agreed):** creators' TikTok accounts via the
   vendored yt-dlp `tiktok:user` (free, verified working 2026-09-08) plus a
   weekly trending-sounds pull (Apify Creative Center actor, ~$1–5/mo).

---

# Running without the Mac (added 2026-09-19)

Geno's question: *"say one day my Mac Mini just goes off and doesn't turn on."*
Before this, everything stopped. Now only the parts that physically need a Mac
do.

| Stage | Where it runs now | If the Mac dies |
|---|---|---|
| Sweep, open accounts | Vercel cron → Apify → webhook | **keeps running** |
| Pick winners, queue them | Vercel (the webhook) | **keeps running** |
| Draft every model's week | Vercel cron, Sunday | **keeps running** |
| Transcribe a queued reel | Mac (whisper.cpp, Metal) | **cloud fallback** — Workers AI |
| Plan video → R2 | Mac | **cloud fallback** — presigned PUT |
| Sweep, gated accounts | Mac (burner session) | waits — needs a residential IP |
| On-screen text (Vision OCR) | Mac | waits — macOS only |
| Diarization | Mac | waits |
| Library video preview | Mac tunnel | falls back to the Instagram link |

**The switch is the heartbeat.** `/api/worker/cloud` does nothing while the
Mac has pinged within `STALE_AFTER_MIN` (90 minutes — it pings every 30
seconds, so ninety minutes means gone, not busy). The daily cron calls it, and
so does the sweep webhook when it queues winners, because a fresh CDN link is
worth about 33 hours.

**How the cloud can fetch a reel at all.** Instagram blocks datacenter IPs for
its *site* — the reason the Mac does the fetching — but not for its media CDN:
measured 2026-09-19, a Vercel function pulled an 11.4 MB reel in 868 ms. So
each sighting now stores the signed `audio_url` / `video_url` / `poster_url`
Apify returns, with the expiry read off the link's own `oe` parameter. The
audio track alone is ~150 KB for a 17-second reel.

**Verified end to end 2026-09-19** by stopping the launchd worker and
backdating the heartbeat: 24 reels transcribed through Workers AI with no
failures, tagged by the same rule-based tagger, silence correctly recorded as
silence (VAD, not a guess); the Mac restarted and the fallback stood down on
its next call without being told. Presigned R2 PUT tested separately against
the live bucket and the test object deleted.

**What a fallback row is missing:** no on-screen text (`has_looked` stays null,
which is what `./bin/relook` hunts for), no speaker labels, no local copy of
the video, and no poster if the image was over 120 KB. When the Mac returns,
those can be filled in.

**Cost:** Workers AI Whisper is ~$0.0002 a reel with 10,000 free neurons a day
(~640 reels), on the Cloudflare account that already holds R2
(contact@sinauraco.com). Failover normally costs nothing.

**What still needs the Mac, honestly.** Gated accounts (half the watchlist)
need a residential address and a signed-in session; a datacenter IP there is
*more* likely to be flagged, not less, so that half waits. If the Mac is gone
for good, the options are another machine at home, or a residential proxy —
not a VPS.

---

# Why a reel, in words (added 2026-09-19)

Geno: *"for a model, they don't know what the X is, so they're not going to
read that."* Right. `8.53×` is the correct maths and the wrong sentence.

`cloud/src/lib/appeal.ts` turns four measured signals into badges:

| Badge | Rule | Measured from |
|---|---|---|
| **Blowing up** | ≥5× that creator's median **plays**, posted ≤7 days ago | top decile of 921 in-window reels |
| **Proven hit** | same, but older | — |
| **Doing well** | ≥2× their median plays | — |
| **People reacted** | (likes+comments) ÷ plays ≥ 6.6% | corpus median 2.4%, top decile 6.6% |
| **Still climbing** | plays up ≥25% since last sweep | needs two sightings, hence `plays_prev` |
| **Trending sound** | ≥2 watched creators on that audio in 14 days | 25 such sounds on 2026-09-19 |

Her card shows one line — `Proven hit · 765K views` — and nothing at all when
there is nothing true to say. The console keeps the numbers in the badge's
tooltip. Rows the sweep has never seen fall back to the old engagement measure,
worded as **Popular**.

**Views are the measure now**, not likes: `videoPlayCount` is on every
sighting. `hot.ts` is still untouched and still engagement-based; the next step
is letting it take its median from sightings too, once there are a few weeks of
them.

## Watchlist and sounds

- **Creators → Watchlist**: paste handles or profile links in bulk. This is how
  the sweep reaches outside the niche — a comedian or a cooking account watched
  for its *format*, which travels between niches better than its subject does.
- Accounts found collaborating on a picked reel land as **suggested** and cost
  nothing until someone taps Watch. Tagged brands (@starbucks) turn up there
  too; that is what "Not for us" is for.
- **Library → Sounds going round**: audio two or more watched creators used in
  the last fortnight, rising first, with a link to hear it.

---

# Knowing who a creator is, without reading 195 profiles (added 2026-09-19)

Geno: *"having to go through 195 creators and make sure that they're all
tagged kind of seems a little bit unrealistic."* It is. 178 of 196 watched
creators had no persona, and persona is the most load-bearing tag in the
system — inherited by everything that creator posts, and the thing that
decides which model is shown her work.

## What the evidence actually is

`scripts/profiles.mjs` pulls each account's bio, category and followers
through Apify's profile scraper (~$0.0023 each, $0.45 for the watchlist).
Two findings from the first run, both worth keeping:

- **Bios are empty here.** 148 of 196 have one and it is almost always
  "check highlights ↓". Five mention goth, four mention mom, two mention
  latina. The bio is *not* the dense signal it is in other niches.
- **Only 57 of 196 are professional accounts.** That is the answer to the
  long-open `business_discovery` question: Meta's free route would have
  covered under a third of this watchlist even before age-gating.

So the evidence is the pixels and the captions: eight still frames from her
best reels, up to fifteen captions, and any on-screen text.

## The profiler proposes; a human decides

`cloud/src/lib/profiler.ts` sends that evidence to Cloudflare Workers AI
(`mistral-small-3.1-24b-instruct`, vision) with **our own 32-tag vocabulary**
and takes back at most three ids plus one sentence of reasoning. Tags outside
the vocabulary are dropped rather than coerced. It writes to
`transcriber.creator_proposals` — never to `creators.persona`.

Creators tab → **"Who these creators are"**: her frame, her numbers, the
model's reason, and the whole chip row with its picks lit. Tap a chip to
correct it, **Take** to apply (which carries the persona to everything she
posts), or **None of these**. `decision` records which of the three happened,
so the proposer's accuracy is measurable later rather than assumed.

**Why a model when rule 3 says deterministic:** the evidence is pixels. A
lexicon cannot see a black-walled room or latex, and the bios are empty. The
discipline is kept where it counts — fixed vocabulary, evidence shown beside
the answer, a human deciding — which is the same shape as `brief.ts`.

**Measured before trusting:** against the six creators with both a human tag
and sweep evidence, three overlapped outright. The misses (`pregnant`,
`milf-mature`) are facets a still frame cannot show, not nonsense — and one
human tag (`pregnant`) may simply be out of date. Treat the panel as a
first pass, not an oracle; @clips, a 17.8M-follower meme account, got three
confident tags that are all wrong, which is exactly what "None of these" is
for.

**Chaining:** `POST /api/creators/profile {"chain":true}` profiles three, then
hands the baton on, until nothing is left. About 12 seconds a creator and well
under a cent each.
