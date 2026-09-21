# Handoff — 2026-09-20, the night Apify stopped being needed

Read this, then `docs/SCOUT.md` and `docs/SCOUT-SETUP.md`, then the project
memory. `docs/GAME-PLAN.md` is still the strategy. The previous handoff is
archived at `docs/HANDOFF-2026-09-19-scout.md`.

Everything below is committed on `main` and deployed. Working tree clean, 25
commits since `e8c9e34`.

State at the end of the session: **745 library items, none without a video**;
**745 jobs done, none failed**; **193 watched creators readable** (3 missing);
**7,723 posts** and **188 snapshots** in the analytics tables; **$0.00 spent**.

---

## Update — 2026-09-20 evening

**Handles.** Geno put handles on the model pages. 22 of 24 have one; **Alexis
Heart and Lae have none** and the roster pass will skip them. `--roster` reads
`models.handle` only, but Chelsea, Faye, Milky, Rey Rey and Snow list more than
one Instagram in `socials` — only one account per model is measured. Ask which
is the main one before building the Winners Bank on top of it.

**Built and verified in a browser (desktop + 390px):**

- **Why it worked** — `lib/why.ts` (query) + `lib/reasons.ts` (wording) +
  `WhyChips`. On every creator-sheet reel at 2×+ her median plays: trending
  sound / proven format / shared widely / heat run, or "new concept" when none
  fire on a measured post. Thresholds are named constants with the measurement
  that set them in the header comment. The sheet now also shows the plays
  multiple beside the old engagement ×, because reasons key off plays.
- **The week** — `lib/digest.ts`, `GET /api/digest?week=`, a **Week** tab.
  Patterns are counted over the strongest 20 winners, not all of them — the
  library is all picks, so 2×+ is 115 of 130 posted and "in common" over all
  of them is just the library average. House styles (formats on >1/3 of the
  library) are excluded. Computed live, never stored — deliberately kept out
  of `scout_runs`, whose rows gate the paid Apify fallback.
  `bin/autodraft` prints the ending week's headline after drafting; a digest
  failure exits 0.
- **Scale** — measured every hot route under 0.5s. The only full-table scans
  on a table headed for 100k+ rows were the time-window reads on `sightings`
  (`risingSounds`, `candidates`); added `sightings_posted_idx`. A cadence
  rollup and paging on `/api/creators` were **not** built: nothing reads
  cadence across many handles yet, and per-handle reads ride
  `creator_posts_handle_posted`. Build them when a caller needs them.

**Missing creators — cause found, fix NOT applied (needs Geno's OK).**
`scripts/fix-handles.mjs` skipped any author that already looked like a handle,
so one-word lowercase display names survived: `mila` → `notcherryygrlfrnd`,
`mya` → `cute.xmya`, `r4ven` → `bbyd0llr4ven`, and also `honey` →
`honeyybee.bby`, `scarlet` → `lil.timm`, `vampy` → `vampingbites`. The script
is fixed; `node scripts/fix-handles.mjs` (dry run) lists 43 rows. The sweep has
been reading *strangers* under the wrong names (`@honey` is a 102k account: 31
sightings, 48 posts; none were picked into the library). Applying needs
`--apply`, then deleting those strangers' `sightings` / `creator_posts` /
`creator_snapshots` rows with a rollback record first — the permission
classifier blocked that as a mass delete, correctly asking for a human.
`blondiiefallon`, `dulcediosaa`, `meliwesty` are real handles returning
nothing — likely renamed or deleted; check with `./bin/scout --check-burner`
when no other browser pass is running.

---

## The one fact that explained everything

`/api/v1/` — the private endpoint `scout_ig.py` was built on — **is retired.**
Instagram's own site no longer calls it. Proved on a tethered phone's Web
Inspector: filter the Network tab for `graphql` and rows appear; filter for
`api/v1` and nothing does.

That single fact explained three failures that had looked unrelated: a burner
reader that had never once worked, yt-dlp failing on exactly the reels the
burner found, and a 429 that appeared for every account, every header set and
every wait.

**The fix was to stop constructing requests.** `src/scout_browser.py` drives a
real headless browser, signed in as the burner, to the pages a person would
open, and keeps the JSON the site fetched *for itself*. When Instagram changes
its queries the site changes with them and this keeps working. Nothing is
scraped out of the DOM either — it is the same structured JSON, obtained
honestly.

**Do not re-point anything at GraphQL by hand.** The `doc_id`s resolve at
runtime from Relay metadata and rotate without notice; the page's own bundles
carry no literal one. That treadmill is what this design avoids.

---

## What is now true that was not

**The gated half is gone as a problem.** 72 creators were unreadable at the
start of the night. All 196 are readable now, and reading them costs nothing —
the browser reader neither knows nor cares whether an account is gated.

**Apify is a fallback, not a habit.** Once every creator was marked `open`, the
next Saturday would have sent the *whole* watchlist through Apify at ~$4/week.
`--only burner` now reads all 196 free, and `/api/cron/daily` starts a paid
sweep only if none happened in three days. Money is spent only when the Mac is
asleep, gone, or its session died — which is what putting it in the cloud was
for. Apify takes minutes, the browser ~2.5 hours; hours are free overnight.

**The analytics layer exists.** Two tables beside the scoring pipeline, never
inside it (`cloud/schema/analytics.sql`, the first schema here under version
control):

- `creator_posts` — every post, any type. 7,723 rows over 190 creators: 5,734
  reels, 1,601 carousels, 348 photos. The carousels are the point — "2–3
  carousels a week" cannot be counted from a table that drops carousels.
- `creator_snapshots` — the account header, one row per pass. 188 rows, 122
  with a story up.

`/api/analytics/<handle>` answers, per creator: top videos by plays, posting
frequency by type, reels/day and carousels/week against target, story days,
longest gap, follower movement. Rendered on the creator sheet as a scorecard
that says "not yet" rather than "behind" when the record is too thin to judge.

**Shares are captured** — `media_repost_count`, 5,583 posts, top reel at
285,464. Geno assumed this was invisible; it is not. **Saves genuinely are not
public.**

**Stories are solved, and that is why the daily pass exists.**
`latest_reel_media` is a timestamp of the most recent story, `0` when none is
live. A story expires in 24 hours, so the Saturday sweep can only ever say
whether one was up on Saturday morning. `bin/scout-daily` reads headers alone —
one page load each, no scrolling — at **19:00 daily**, deliberately never
alongside the deep sweep, because two browsers on one session is what makes a
burner look automated. Loaded as `com.geno.social-transcriber.daily`.

**The phone is out of the loop.** It handed over one cookie. The browser now
saves and reloads its own storage state and Instagram refreshes a session as it
is used, so the Mac keeps itself signed in. Geno can unplug it, but should stay
signed in on it — logging out invalidates the session server-side.

---

## What is left, in the order it matters

### 1. Blocked on Geno, and it blocks everything after it

**The model handles are wrong.** Only `kaytie_golfs` is real. `snow` does not
exist under that name; `fayewest` and `magnus` are different accounts. Nine of
the 24 returned 3–4 photos and no reels, which is what a stranger's small
account looks like.

He said he would put correct Instagram handles on the model pages and send a
full list (IG, plus TikTok where it exists). **Remind him.**

**Do not run `./bin/scout --roster` until then** — it reads whoever owns those
handles and files their posts under our models. Nothing was stored on the first
attempt, so the tables are clean; keep them that way.

Also needed: **`formats` and `hooks` per model — 22 of 24 are empty.**

### 2. The 70/20/10 split, which needs 1 first

Geno's full breakdown arrived mid-session (source: Marketing Mastery HQ,
Notion). The short version:

| Bucket | Meaning |
|---|---|
| **70% Reskins** | her own proven winners — **>10× her rolling 30-day median views** |
| **20% Iterations** | medium performers — **3–5× median** |
| **10% New Tests** | new verticals, trends, angles |

21 reels/week is 15 / 4 / 2. Posting: 3 reels/day at 10:00 / 13:00 / 18:00,
1–3 carousels/week, never two posts inside one hour.

**A post's bucket comes from its measured performance against her own median —
never from its format.** A first implementation classified by `models.formats`
and was wrong on that axis; it was rebuilt. `lib/mix.ts` **measures and does not
yet pick** — changing how winners are chosen and what they are measured against
in one step is this project's standing rule.

Two gaps that are in his source docs, not introduced here: **watch-through rate
is half the grading matrix and lives only in her own Insights**, so only the
views axis is computable from outside; and the **5×–10× band is undefined**,
treated here as Iteration, the conservative reading.

**One question he has not answered:** the library is *other* creators' viral
reels, but the 70% is reskins of *her own* winners — so the library mostly feeds
the 10%. The 70% wants a **Winners Bank of her own posts**, a different store
from the one we filled all night. Raise this before building.

### 3. Parked at his request, mine to build

- **"Why it worked"** on the creator sheet — trending sound / heat run / proven
  format / new concept. Derivable from what is captured: `audio_title`
  frequency across creators, the creator's own median, `media_repost_count`.
- **Weekly digest** — the week's top concepts and what they had in common. A
  natural extension of the Sunday autodraft job.
- **The 3 "missing" creators** — watched accounts returning nothing. Likely
  deleted or renamed.
- **Scale work** — pagination and a materialised cadence rollup. Fine at 745
  items; needed well before the hundreds of thousands he expects.

---

## Bugs fixed tonight, and what each cost

- **Collab reels broke whole batches.** `ON CONFLICT DO UPDATE command cannot
  affect row a second time` — a coauthored reel sits on both creators' profiles
  under one shortcode, so sweeping both puts it in the batch twice. Cost ~590
  reels before being diagnosed **from Vercel's runtime log** rather than guessed
  at. An earlier commit had blamed payload size and shrunk `CHUNK`; that was
  wrong. De-duplication now lives in the three store functions.
- **yt-dlp could not download burner-found reels.** All 24 failures were
  `via: burner`, none from Apify — the same retired endpoint. Nothing needed
  resolving: the sweep had already stored `video_versions[0].url`. The claim
  route now hands the media over with the job and `media.download` falls back to
  it. Instagram's CDN serves those files to anyone.
- **The library player was black.** The Mac served 206 `video/mp4` perfectly;
  what was missing was `Access-Control-Allow-Origin`, and the player carries
  `crossOrigin="anonymous"` because the caption `<track>` is always a CORS
  request. The browser received the bytes and discarded them, silently.
- **19 items had no video at all** — transcribed by the Cloudflare failover
  while the Mac was down, so the Mac never held the file. They sorted to the
  *top* of the library (newest `upload_date`), so they were the first thing
  clicked, which is why it looked like every video was broken. All 19
  re-fetched; the panel now says so when a video is genuinely missing.
- **bigint came back as strings.** `plays`/`likes`/`comments` are bigint and the
  driver returns text to keep 64-bit values exact. `topPosts` passed them
  through, so `"9"` sorted above `"10"`. Coerced at the boundary.

### Two mistakes worth not repeating

**Editing a module a live worker imports is a race.** Adding the *use* of a new
parameter before adding the parameter itself meant launchd restarted the worker
into a half-written file and burned 24 jobs on `NameError`. Finish the file,
exercise the real path, *then* restart.

**A test that does not walk the caller's path is not evidence.** The same fix
then failed again because `process()` delegates to `_process_in()`, and the
parameter went on the outer function while the edited line sat in the inner one.
The helper passed in isolation; the worker never could.

---

## Traps still standing

- **Vercel Hobby crons are daily-only.** One `/api/cron/daily` at `0 14 * * *`
  (14:00 UTC = 10:00 EDT) decides by weekday. It slides to 09:00 ET after 1 Nov.
- The Mac's 17:00 Sunday autodraft still fires and is **harmless** —
  `previewBatch` computes `wanted = weekly_target - already`, so it writes
  nothing when the week is already full.
- **The Workers AI free tier is enough — do not buy the $5 plan.** Whisper is
  46.63 neurons per audio minute, so 10,000/day is ~428 reels. The profiler is
  the only thing paying would buy, and only speed.
- **The profiler eats the whole daily allowance**, so it must not run while the
  Mac is down — Whisper failover shares it.
- **CSS tokens** are `--sc-ink-900/700/500/300/150`, `--sc-bone`, `--sc-ember`,
  `--sc-rule-hair`. Inventing one fails silently.
- **Deploys no longer prompt** — `.claude/settings.local.json` at the repo root
  allows `vercel --prod`. Claude cannot write that file itself (self-modification
  guard), and that guard is correct.
- **Verify UI claims by loading the page.** Sign in with `APP_PASSWORD` from
  `cloud/.env.local` and drive Playwright (installed in `.venv`). Reading the
  diff is not verification — both UI bugs above survived a diff review.
