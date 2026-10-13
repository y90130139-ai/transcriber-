# 2026-10-09 (morning): the Reddit drop merged + verified — read this first

Main = `8301133`, pushed, in sync with origin. **Undeployed** — prod is still
at `787e3f4` (plus whatever Geno deployed mid-session on the 8th). 218 tests
green, `npx next build` clean. Deploys are Geno's unless he asks.

- **"New v2" (`1224467`, y90130139-ai)**: a whole Reddit Trends system
  (~20k lines — `lib/reddit/*`, `(console)/reddit-trends/*` pages,
  `/api/reddit/*`, `/api/cron/reddit`, own `reddit` Postgres schema,
  `docs/REDDIT-TRENDS.md`) plus plan-side additions (plan-drafts, plan-read,
  DueDateField/calendar, models delivery + open routes, VolumeStepper). It
  branched off the OLD ASAS commit `b1cbbab`; **"ASSA" (`5ce851a`) is the
  merge** bringing our fixed line (conflict-marker fix + Apify restore + V4)
  back in. Verified after the merge: no raw conflict markers this time, and
  source.ts / template.ts / german.ts / scout-apify.ts / interestOverTime /
  cron startSweep all intact.
- **Reddit migration RUN against Neon 2026-10-09** (13 tables in the new
  `reddit` schema, all idempotent creates — nothing touched `transcriber`).
  The new plan-side code reads only columns the V4 migrations already created.
- **Collector stays disabled until Geno adds `REDDIT_CLIENT_ID` /
  `REDDIT_CLIENT_SECRET` (+ optional UA/contact) on Vercel** — a Reddit
  "script" app under his account, read scope. Without them the pages show a
  setup checklist.
- `npm install` was needed in `cloud/` (New v2 added `date-fns` +
  `react-day-picker`); without it the build fails module-not-found. Vercel
  installs its own, so this only bites local builds.
- **Win-back (`8301133`, 03:37 EDT)**: the Infloww win-back list now goes out
  one message per creator (another session's commit; tests cover it).
- **Tonight ~19:00: the first single-burner scout pass over all ~196
  accounts** (`~/Library/Logs/social-transcriber-daily.log`). Last night's
  story pass was healthy (357 snapshots). If Friday fails, Saturday's
  restored Apify sweep covers the open half.
- The gosian-bot FansLink launch cleanup is CLOSED (geno-78's session,
  2026-10-09): Mona's INVOICES topic 577 had exactly one schedule post,
  already pinned by Geno by hand — no deletes, no promote needed; Priscilla's
  MARKETING 1222 re-point is pushed (bot `ced54bc`). This project was not involved.

Still waiting on Geno: ANTHROPIC_API_KEY on Vercel, RESEND keys, REDDIT_*
keys (new), D-tier sprint spec, Railway gated-intake setup.

---

# 2026-10-08 (overnight): V4 plan system shipped end to end

Prod = `787e3f4`, deployed READY (deploys by Claude are allowed when Geno
asks explicitly; `npx vercel deploy --prod --yes` from cloud/). All
migrations are RUN against Neon. 164 tests green. Memory file
`transcriber-next-up.md` has the fuller trail.

## Shipped tonight (one night, ~20 commits)

- **Mixed-source cards (V4, Geno's pick from the mockup canvas
  https://claude.ai/artifact/Ln3pjrZrE3wioDHvQgsX73):**
  `plan_items.source` (reference/reskin/original/ai_draft/blank) +
  `twist`; her chips say "Copy this one / Your twist on it / Made for
  you"; ai_draft+blank never reach her page or preview; lib/source.ts.
- **Templates on the model** (`models.plan_template`,
  sprint/mix/winning/custom, null=auto): lib/template.ts ladder
  (0 winners→Sprint, 3+→Winning), split.ts honours sprint (all-test at
  full target) and winning (match on her proven formats), draft skips
  custom. /api/models/[id]/verticals + /template.
- **Editor:** per-card Source select + twist; remove-Undo (DELETE
  returns the row, POST {restore} re-inserts — thread dies, rest
  survives); format chips filter suggestionsFor (won't-do struck);
  template picker + winners nudge; plan intake box (paste IG/TikTok/YT
  links or drop files → cards on THAT plan, named "V-121 · V-122",
  scrolled-to + lit, 'fetching' state off jobs.status + 12s re-poll);
  plans.target + dots; brief-as-fields grid REMOVED (Geno:
  "irrelevant"); Film it / Captions per-card toggles (hide_film /
  hide_captions) with "+ add a caption yourself" when off; ①②③
  versions picker (original→Version 1, siblings numbered, grouped
  right behind the original — plain ⧉ too); written cards (job_id
  null) have state 'written', never "no video on disk".
- **Queue:** three-column composer — Format (+ make a new one →
  transcriber.custom_formats) · What it is (German playbook when
  german; saved per-format kinds in transcriber.format_kinds, "+ Add
  what it is…", never disabled) · links/files. Labels + origin-human
  format tags ride /api/links AND /api/uploads (clientPayload).
  Stuck rows: Retry + Dismiss (item DELETE), phone-safe grid.
- **German playbook:** lib/german.ts — 57 formats / 6 reel types from
  German_Flash_Trends_by_Reel_Type.docx; conduct cuts tested (#1/#2
  absent, #52/#64 cleared captions only). All 65 reference videos
  ingested from the doc's Drive links (batch german-2026-10-08, all
  done, labeled "German #N · Name", tagged format=german origin
  human). scripts/german-refs.mjs + german-videos.json rerun the batch.
- **Worker fix:** a file upload labeled with a human name lost its
  extension on the Mac → bare `source`, no poster, nothing to serve;
  _source_for now takes the extension from the blob URL. Worker
  restarted; the one broken job repaired by hand.

## The ASAS pull (26a09ff + b1cbbab) — handle with care

- It committed RAW conflict markers in migrate.mjs / CustomCard /
  PlanEditor (resolved in 6587c04 keeping both sides) and a migration
  of Scout toward Railway: Apify DELETED, railway_worker/watchdog.py
  added, docs/RAILWAY-MIGRATION.md, console instagram/tiktok/twitter
  pages, DropSelect, trends-ask lost its Anthropic engine (Workers
  only now — quiet reversal of a pending key decision; other four
  Anthropic features intact).
- **Apify sweep RESTORED (787e3f4)**: the deletion left one burner on
  one Mac as the whole intake with Railway scraping shipped OFF. Same
  3-day scout_runs stand-down, so no double pay.
- **Railway gated intake still needs Geno:** two services
  (railway.json / railway.watchdog.json), CLOUD_URL + WORKER_SECRET,
  /data volume, rotated DISCORD_WEBHOOK, and ENABLE_INSTAGRAM_SCRAPING
  only after a residential-proxy burner probe passes. Datacenter IP =
  the thing Instagram flags; the doc itself says validate first.

## Watch next

1. **Friday 2026-10-09 ~19:00 pass** — first run of the new
   single-burner-reader scout.py covering all ~196 accounts alone
   (`~/Library/Logs/social-transcriber-daily.log`). Sightings are at
   2026-10-03; if Friday fails, Saturday's restored Apify sweep covers
   the open half.
2. Leah (Cassie)'s week: 7 cards verified intact and grouped
   (Halloween Versions 1-4 on top) after the hide_film outage — a
   missing-column 500 that rendered as "No week open"; data was never
   touched.
3. Still waiting on Geno: ANTHROPIC_API_KEY on Vercel (now gates
   /q, Strategy, quality vision — trends dropped by ASAS), RESEND
   keys, D-tier sprint spec, first Strategy report run.

---

# 2026-10-08: Trends, round four — the Google Trends shape

**Same-day flatten pass (Geno): "one bg, no hue, no cards or borders."**
The hero graph that had been drawn behind the type is gone (component and
all its CSS deleted), the "Reading the board…" text is gone from both the
page load and the AI thread, and every surface sits on the console's one
ground: hero band + ember glow gone, chart/panels/ask box de-carded, the
trending list is now plain rows (rank · term · breakdown as muted text ·
figures right), range pickers and chips are borderless pills/text,
"Use on Instagram" is a plain ember link. Controls (search pill, selects,
buttons) keep their hairlines. Verified by screenshot at 1440 and 390,
graph re-checked after the pass; 143 tests + build green.

Geno: "like Google Trends, in our own colours." The /trends page is now
hero → graph → live list → ask box → library panels.

- **Hero** (`TrendsTab.tsx`): full-bleed band under the topbar — "Explore
  what **the United States** is searching for right now" with the place
  name in an ember block (Google's yellow highlight, our accent), a pill
  search with an ember dot and an Explore button, and the top three live
  terms as hint chips. The trending window/place/sort/CSV controls moved
  into the list's section header.
- **Interest over time** — the parked BigQuery curves, built without GCP:
  Google's own keyless explore + multiline pair (the endpoints
  trends.google.com/trends/explore calls). `lib/trends.ts`
  `interestOverTime(terms, geo, range)` warms an NID cookie (explore 429s
  without one; the page hands it out even when throttled), mints the
  TIMESERIES token, spends it on the multiline series, caches per
  (terms, geo, range) 15 min in `transcriber.trends_interest_cache`, and
  serves a stale cache when Google sulks. Pure parsers
  (`parseInterestExplore`, `parseInterestTimeline`, `parseInterestQuery`,
  `cleanInterestRange`, `interestStamp/Tick`) in `trends-feed.ts`, tested.
  New route `/api/trends/interest` (`term` repeated, up to 5).
- **The graph** (`TrendsChart.tsx`, hand-drawn SVG, no dependency): one
  area + line per term (ember, green, gold, rose, grey — apart on the
  ink ground), 0–100 grid, UTC axis ticks, hover crosshair + tooltip
  reading every series, legend with averages and an × per term. Its own
  range picker is Google's: 24 h / 7 days / 30 days / 12 months / 5 years.
  Search parses "a vs b" and commas; trending cards are buttons that draw
  their own graph. Empty state draws a ghost spike; Google refusing the
  explore call shows a Try-again veil (seen live during verification —
  rate limiting is real; the cache is the mitigation).
- **Trending now as cards**: rank, volume, spike %, started, breakdown
  chips, click-to-graph, small Google-search link on hover. Archive
  fallback unchanged. Trends AI box moved below the list (the graph is
  the feature now); library breakouts/sounds unchanged.
- **Schema**: `scripts/migrate.mjs` now carries all three trends tables
  (`trends_terms` and `trends_live_cache` were only ever created by hand
  in Neon; `trends_interest_cache` is new). Migrate run against Neon —
  cache verified end-to-end (169 points written, second call served
  from the row).
- **Verified**: 143 tests green (5 new), `npx next build` clean, desktop
  (1440) + mobile (390) screenshots via the Windows port of
  `docs/rollback/cdpshot.mjs`, graph checked on 7 d and 24 h, comparison
  "namibia vs usa" through the form. **Not deployed — Geno runs the
  Vercel deploy.**
---
# 2026-10-07 (later): polish round + Discover playback — read this first

Everything through `ec96ed4` is on GitHub `main`, 138 tests green, build
clean. **Deploys are Geno's** (`! cd ~/projects/social-transcriber/cloud &&
npx vercel deploy --prod --yes`); the last deploy this session VERIFIED was
before the eight-asks batch — assume everything from `fa9d36d` on is
undeployed unless Geno says otherwise.

Shipped after the eight asks:
- **Brand & niche un-flattened** (`4c94b06`): the ASAS console's masthead
  logo claimed `.brand` (flex) and crushed the merged section into slivers;
  renamed ours to `.brandtab`. Verified by logging into the LOCAL app with
  Playwright (APP_PASSWORD from cloud/.env.local, posted to /api/auth —
  works; keep the password out of chat). "What she says yes to" also stops
  counting tag `unknown`.
- **She can change her photo any day** (`4c94b06`): Make-it-yours gained
  the photo picker; posts `{data_url}` to /api/plan/<token>/photo → same
  models.photo_url the console reads; header img swapped in place.
- **Reels-tab polish** (`9b760df`): Blueprint tab REMOVED, Sunday call
  REMOVED, the 5 trial cuts fold to ONE card ("Trial · 5 cuts", Done closes
  the batch — groupTrials() in ReelsTab), strip cards flex + pin action
  rows (fixes editor strip AND Analytics most-viewed lopsidedness).
- **Quality check rebuilt** (`9b760df`): the old prompt hardcoded
  "outdoors high / bedrooms low" over ONE poster frame — the source of
  every "change the background to an outdoor setting" note. Now: lateral
  join by shortcode pulls transcript/on-screen text/measured shots when the
  reel is ingested (pacing = measured, else dropped), neutral judge-it-for-
  what-it-IS rubric, frame-only reels say so honestly, Claude vision
  (sonnet) once ANTHROPIC_API_KEY lands else Workers vision. All old
  quality_checks rows DELETED so everything re-scans. NOTE: most of a
  model's own posts are frame-only (not ingested) — the rich path needs
  her reels in the library.
- **Discover plays inline** (`ec96ed4`): deck cards carry a signed Mac
  tunnel link (same linksFor/mediaBase as the console library) — top card
  autoplays muted, 🔇 corner button unmutes, resets quiet per card. Mac
  asleep → poster + Instagram link as before. The R2 pipeline for
  always-on playback stays parked.

Still waiting on Geno:
- **ANTHROPIC_API_KEY on Vercel** — now gates FOUR things: OPS /q, Trends
  AI web search, Strategy reports (opus), quality-check vision judge.
- **RESEND_API_KEY + RESEND_FROM** — editor email notifications (the
  copy-link path works without them).
- **D-tier 30-day sprint programme** — saved task, Geno will spec it.
- First Strategy report run on a real model; verify a live portal week's
  two piles; watch the first Scout 19:00 pass on the ASAS-rewritten
  login files; Wed 16:00 ET plan reminders (first window was 2026-10-07).

# 2026-10-07: Geno's eight asks (through `918fc45`) + the ASAS restructure

**The ASAS commit** (`60a9ca6`, author `y90130139-ai`, +0530): console went
route-based — `(console)/` pages + ConsoleShell/ConsoleProvider, Workbench
DELETED. It shipped no /trends route (fixed, `6e9f85f`) and rewrote the
Mac-side Scout login/session files — **watch the next 19:00 pass**. Geno
treats the commit as his; identity never explicitly confirmed.

**The eight asks, all shipped:**
1. Taxonomy: format `omegle`, persona `comedy` (+ lexicon + ES labels).
2. Library cards: 🔇 Sound button — unmutes the hover preview, pins playback.
3. D tier = "construction, 30-day sprint" (no platform): roster group, chip,
   sorts below everyone in batch. **The 30-day sprint programme itself is a
   SAVED TASK for later — Geno: "we'll get more into depth after that."**
4. Messages tab on the model profile: every card thread, ANSWERED derived
   (last word ours), inline reply (marks read, same rule as the editor).
5. One card per reel: appendItems refuses same-plan repeats (ladders collapse
   to their control), draft keeps a reel out of her pool 42 days
   (REPEAT_COOLDOWN_DAYS), 151 bare duplicate rows deleted from Neon.
6. Custom cards + `plan_templates` (new table): + Custom card in the plan
   editor, label/format/directions, job_id now NULLABLE (her card skips
   Watch-it), templates persist and are editable.
7. Editors ecosystem: `editors` table + plan_items.editor_id/editor_notified_at,
   per-card Editor picker, /e/<token> page (notes + player + download),
   'Tell them' emails via Resend when RESEND_API_KEY/RESEND_FROM exist else
   copy-link. **Editing notes now in-house: stripped from her payload.**
8. Brand tab folded into Profile ('Brand & niche' section) + "What she says
   yes to" (tags of her 👍/accepted, via /insights `her_picks`) + plan
   editor "Before it goes" line (unanswered questions, unassigned edits).

# 2026-10-06 (later): Trends tab, Baby pink, the week in two piles

**Round seven (`20b9c4c`): intro → "In this plan".** The plan page's intro
paragraph and the editor's intro box are both gone (plans.intro column
untouched). In its place a counted contents block (`lib/plan-contents.ts`,
pure + tested): per-format counts from each card's FIRST format tag
(taxonomy labels; untagged cards count as "Videos"), plus fixed lines for
the carousel minimum (CAROUSEL_PLAN.count) and 7× stories. Renders for
ideas only (own-videos/declined excluded), in the portal and the preview.

**Round six (`2a50737`): the Strategy tab — Creator Intelligence reports.**
Geno's 24-section template (pasted 2026-10-06, embedded as `REPORT_PROMPT`
in `lib/report/spec.ts`) now generates per model: new profile tab
**Strategy** (between Blueprint and Week). `lib/report/evidence.ts` gathers
profile fields, latest survey answers, up to 3 `model_intake.raw` dumps,
top-8 reels by plays, up to 6 transcripts of HER OWN videos
(`transcripts.author` = her handles), decline reasons grouped, 👍/👎
counts, and her last 30 plan-thread messages — plus an optional paste box
per run (meeting notes). Output: structured sections + **gaps** (questions
to ask her) stored in `models.about` (first use of that column) with
engine + sources provenance. **Corrections are permanent**: PATCH appends,
every regeneration folds them in as overrides; the report text is never
hand-edited. Engine: `claude-opus-5-5` when ANTHROPIC_API_KEY lands (this
is the feature that most wants it), gpt-oss on Workers until then (UI says
so; shares the captions allowance — the first live run is Geno's click,
NOT tested end-to-end against a real model yet). The second half of
Geno's paste (the reel-writing creative-director prompt) is NOT built —
it is the future consumer of these reports; ask before wiring it into
plan generation.

**Round five (`449db5c`): subscription revenue broken out.** Earnings board
gets a Subscriptions total (money + new/renewal counts + % of agency net),
the accounts table a Subs column, each model's Earnings tab a Sub revenue
stat (+% of her net). Read-side only over `earnings_days.by_type` — history
included, no pull changes. **Free trials: NOT possible from this key.**
Probed 2026-10-06: Infloww's open API has exactly two endpoints
(`/v1/creators`, `/v1/transactions`; fans/subscriptions/stats all 404), and
a 30-day scan of the whole roster found 0 zero-amount rows in 1,572 sub
transactions — a $0 trial join writes no transaction, so trial starts and
trial→paid conversion are invisible. Told Geno; if trials matter, the
options are Infloww's app (manual), or asking Infloww for API scope. A
new-vs-returning-fan split from `fanId` at pull time IS possible — not
built, fan-level storage is a policy question (day rows are creator-only).

**Round four (`edd9569`): the Google panel IS Trending Now.** Geno's
screenshot of trends.google.com/trending showed no resemblance to the RSS
panel, so the panel now reads the page's own keyless endpoint
(`POST trends.google.com/_/TrendsUi/data/batchexecute`, rpcid `i0OFE`,
args `[null,null,geo,0,'en',hours,1]`): full list (2,132 rows for US/7d
when probed; we cap at 1,000), per row volume / spike % / started-epoch /
breakdown terms. Parser `parseTrendingNow` in `trends-feed.ts` (pure,
tested, garbage→[]); `liveTrends(geo, days)` in `trends.ts` caches per
(geo, hours) in `transcriber.trends_live_cache` (created 2026-10-06),
TTL 10 min, stale-serving when Google sulks; the RSS daily archive is the
last fallback (its cron unchanged). UI: state picker (US + 50 + DC), sort
relevance/volume/newest, Show more paging, Export CSV, breakdown chips,
term links to Google search. Window picker now maps to real hours
(24/48/72/168, `DAYS_TO_HOURS`). Trends AI grounds on the live top 40 by
volume for the picked geo+window. **Unofficial endpoint** — if it breaks,
the panel degrades to archive; parser treats every field as optional.

**Round three (`9d092a8`): library cards got hands.** `LibraryCard.tsx`
(split from the grid): hover ~250ms plays the reel muted/looping in its own
frame (hover-capable devices; a Preview button pins playback anywhere),
**Save video** (the Mac's signed download link), and **± Caption** folds the
whole caption open with Copy. Card data is lazy: one `/api/items/<id>` fetch
per card per session (module-level cache; a no-media answer is NOT cached so
the Mac waking up heals it). Mac asleep → "Mac asleep — no file right now"
instead of dead buttons. Grid payload and 15s poll untouched.

Three asks from Geno, all on `main` through `5bb5971`, tests green (123),
`npx next build` clean. **Not yet deployed — Geno runs the Vercel deploy.**

- **Trends tab** (console, between Week and Queue). The parked "Trends AI"
  idea, built on the free path only: Google's Trending Now RSS (keyless)
  ingested daily by the 10:00 cloud cron into `transcriber.trends_terms`
  (table created in Neon 2026-10-06; "Pull today's trends" button covers the
  gap before the first cron). Board = terms (with NEW-this-week flags) +
  library breakouts (sightings at 2×+ creator's 90-day median, 14-day
  window) + sounds spreading (2+ distinct watched creators, "Original
  audio"/"Mix" excluded). The ask box answers ONLY from the board:
  `lib/trends-ask.ts` uses Anthropic (`claude-sonnet-5-5`) when
  `ANTHROPIC_API_KEY` is on Vercel — **it still is not** (same pending
  decision as OPS /q) — else falls back to gpt-oss-120b on Workers AI
  (works today; shares the captions allowance, single-shot so cheap).
  Pure parser + types in `lib/trends-feed.ts` (import-free, tested);
  queries in `lib/trends.ts`; ingest verified live (10 terms stored).
  BigQuery/interest-curves from the parked plan still need GCP creds — not built.
  **Round two same day** (`6b485a6`, Geno's asks): window picker
  (Today/2/3/7 — terms only; **reels panels floor at 7 days** because reels
  land in `sightings` with Friday's weekly pass, a 48h reel window is empty
  midweek), direction chips + mini line graphs on terms and sounds (sound
  axis anchored to `max(posted_at)` coverage so un-swept days don't read as
  decline — sparks deepen as `trends_terms` accrues days, only 1 day stored
  so far), breakout **poster cards** from library thumbnails
  (`thumb_job` via the shortcode regex → `/api/thumb/<job>`; 8–11 of 12
  have one), sounds get "Use on Instagram" (permanent
  `instagram.com/reels/audio/<audio_id>/`) and **Save file** only while a
  stored `audio_url` is unexpired (`media_until > now()` — rare except
  right after a sweep; streamed by `/api/trends/sound?title=`), and the
  ask box's **"search the web too" toggle**: real Anthropic
  `web_search_20250305` (max 3 lookups) once the key is on Vercel; the
  Workers fallback answers board-only and the UI says so.
- **Baby pink** palette (`babypink`) in Make-it-yours — 11 presets now.
  Light `#D2648C`, dark `#F49CBC`; pastel carried by the light/tint stops,
  the accent deep enough that white type keeps roughly Sunny's footing.
  Screenshotted both themes via a static harness.
- **Two piles on her plan** (`lib/plan-buckets.ts`, pure + tested): a
  segmented "To review / My reels" switch above the cards. Yes, made-already
  or filmed → My reels; unanswered → To review; declines keep "Videos you
  can't do". Cards report every verdict change up (`onVerdict` on
  PlanItemCard, fired on optimistic set AND rollback); a yes from the review
  pile shows a toast with a View button. Card numbers stay the plan's own in
  both piles. Opens on To review when anything is unanswered. Preview renders
  the same (console = her page, one component).
  **Not clicked through on a live portal** — the auto-mode classifier
  blocked reading a model token, so verify one real week (Magnus: 3 accepted
  / 20 open) after deploy.

# 2026-10-06: the portal grew up — reminders, Discover, themes, home screen

Geno green-lit the whole portal vision except accounts/passwords (token
links stay). All shipped; transcriber `main` through `629c59a`, bot
through `c6aca0d` (pushed = deployed on Railway).

- **Plan reminders** (`lib/reminders.ts` pure + 4 tests, `reminders-db.ts`,
  `/api/bot/reminders`): Wed 16:00 ET if nothing filmed, Sat 11:00 ET if
  anything left, once per plan per kind, ledger `plan_nudges` (recorded on
  failure too). Bot `drainReminders` posts in MARKETING with
  `content_plan.reminder_*` + plan link as text_link. **First live window:
  Wednesday 2026-10-07 16:00 ET** — watch OPS and the bot logs.
- **Discover** (`/p/<token>/discover`, `lib/discover.ts`, table
  `transcriber.discover`): a 10-card swipe deck from `suggestionsFor`
  (same guards as the console rail). Star → shelf + OPS ping via
  `/api/bot/stars` (bot `drainStars`, OPS only) + feeds `TASTE` in
  match.ts at the same weights as 👍. "Add to my week" →
  `recreateTarget` + `appendItems`. Poster frames only (library files
  live on the Mac, not R2) — **inline playback would need a worker
  pipeline to upload deck candidates to R2; parked, ask Geno**.
- **Make it yours** (`lib/portal-style.ts`, `models.portal_style`,
  `/api/plan/<token>/style`): 6 accent palettes × 4 font voices, presets
  only, both themes stated both ways; applied before first paint.
- **Home screen**: per-token `manifest.webmanifest` + `/pwa-icon/*`
  (drawn PNG). **No service worker on purpose** — fresh on every open.
- **Accounts/passwords: rejected** (Geno agreed) — the token is the account.
- Profile-building: the questionnaire (`/p/<token>/survey`) already covers
  v1; a fuller "social profile" page was discussed, not built — ask before
  building. `models.about` jsonb exists, unused.
- **Two sessions ran in the bot repo at once** on 2026-10-06: the other
  shipped the OPS-forum routing (`c4fda3b`, GOSIAN | OPS upgraded to
  topics). 673 bot tests green with both changesets.

# Handoff — 2026-10-01: the viewer runs on Scout's burner (Geno's call)

- **122 failed downloads.** 118 are "could not download" (Instagram's empty
  media response to a logged-out yt-dlp); a 3-job requeue test failed the same
  way. The viewer burner was never created, so on Geno's say-so ("do it right
  away") the viewer now uses **Scout's account**:
  `secrets/viewer-cookies.txt -> scout-cookies.txt`,
  `secrets/viewer-state.json -> scout-state.json` (symlinks, no code change).
  Pacing **doubled** the same night at Geno's call: 10/run, 30/h, 120/day,
  gap 40-100 s (09-23, clear of Scout's passes). **Back to 5/15/60, gap 60-180 s on 2026-10-04**: 124 reels recovered, nothing left waiting. Five reels keep returning "no link found" (Dde1o9ozr8z, Ddr8c50RxaN, Ddu0t2bxklh, DdvCGDIpIrA, DdeOKruBz_I), probably deleted. Risk accepted: if Instagram flags it, Scout's
  weekly intake goes with it.
- **Trap:** `./bin/scout-login --viewer` now writes *through* the links into
  Scout's files. To move to a real viewer burner later: `rm` both links first,
  then `./bin/scout-login --viewer`.
- The other 4 never will download: 2 profile links, 1 photo post, 1 gave up
  after 3 interrupted attempts.
- OnlyFans numbers: Geno confirmed shipped. Meta app: dropped, do not raise.
- **Weekly reels pass moved: Saturday 10:00 → Friday, chained after the 19:00
  daily pass** in `bin/scout-daily` (under `caffeinate -i`; ends ~03:00 Sat).
  The `scout` launchd agent is booted out and its plist retired
  (`docs/…scout.plist.retired-2026-10-01`). Why: the Sat 10:00 pass ran 5 h and
  writes `scout_runs` only at the end, so the cloud cron's Sat 10:30
  `startSweep` saw no sweep in 3 days and paid Apify $9.85 for the same
  accounts on 2026-09-26. ~~Apify over its $19 Starter cap until 2026-10-19~~ —
  **Geno raised the Apify limit on 2026-10-06**, so the Saturday cloud fallback
  can run again whenever the Mac misses a sweep (its only guard is the 3-day
  `scout_runs` staleness check in `cloud/src/app/api/cron/daily/route.ts`).
  First Friday chain: 2026-10-02; check
  `~/Library/Logs/social-transcriber-daily.log` and that Sat's cron skipped Apify.

# Handoff — 2026-09-27 (on top of 26th and 25th: captions from the library, Geno's account out of the machine)

## 2026-09-27, Susanna's feedback — plan content fixed for every model

Susanna (Marketing channel) after reviewing all 50 cards: captions make no
sense, write them for her, stop sending couple videos (3rd time), her own
reels fill the plan and repeat, V-30 can't be copied, no way to ask for more,
wants the OF-scripts step layout. All fixed at **load time for every model and
every week** (`lib/week-shape.ts` pure + tested, `lib/week-load.ts` DB side,
called from `planItemsFor`):
- **"Captions" she questioned were screen-text misreads** shown as the hook
  ("Bal al", "and ORA", a shop's phone number). `readableLine` drops them and
  strips sign text off real lines. Stored hooks are untouched.
- **2–4 captions on every card, each with its own Copy.** Engine captions win;
  cards with fewer than 2 are topped up with the reel's own caption first, then
  library captions that pass `universal` (short question/prompt, no names, no
  he/she, no object — "Mine's Swampy Sewer" can't reach her). Other roster
  models' own captions are excluded. Checked: 0 of every current week's cards
  under 2.
- **Her own reels** (any account in `socials` — Susanna's are on
  @susannadiazxo) added as plain cards go in a folded **Your own videos**
  section, not counted in "filmed"; repeats of one clip (same length ±0.05s,
  same caption) fold to one. Susanna: 50 → 26 shown, 12 own.
- **Solo**: `models.solo` (default **true**, toggle "Who is on camera" in
  Profile, own route `/api/models/<id>/solo`). Couple reels are never added
  (`appendItems`) and are hidden unless she took them on. Detection
  (`lib/solo.ts`): accounts declined as needs-another-person or with 2+ couple
  captions (brisortizig, maslovalexey80, …), couple words/#couples, 3+ voices.
  **Magnus's week went 23 → 9** (the same couple batch; he answered none) —
  flip his toggle if he films with a partner. Susanna's `couples` persona removed.
- **Card = steps**: Watch it · Before you film · Film it · What to say · What
  to write. "Before you film" is Geno's 8-point `FILM_CHECKLIST` in `card.ts`
  (lens, steady, light in front, framing clear of Instagram's buttons,
  background, nothing personal, first line ready, 2–3 takes); the old
  post-filming "Quick check" is gone. New-idea wording: copy the idea, people/reactions never have to match (V-30).
- **👍/👎 "Good reference for you?"** under every video (Geno, replaces the
  first "More like this" button): `POST /api/plan/<token>/rate`
  `{item_id, rating: 1|-1|0}` → `plan_items.rating` / `rated_at`. Not posted to
  Telegram. **It steers picks**: `TASTE` in `match.ts` adds 0.5 per vote for
  every tag a candidate shares with a rated reel and 1 per vote for the same
  account, capped ±3 (one format match) — `suggestionsFor` returns it as
  `taste`. Console plan rows show 👍/👎. V-25 carried over as 👍.
  `suggestionsFor` also drops couple reels for solo models (fetches 2× first).
- **"Videos you can't do"** (`components/plan/CantDo.tsx`): once she picks a
  decline reason the card leaves her feed (and the filmed count) for a folded
  section at the foot of the page — compact rows, her reason, "won't be sent
  again" / "may come back", **Add back to plan** (verdict → open, clears the
  `declines` row). A 6-second "V-12 moved · Undo" notice covers accidental
  taps. Declined couple reels now show there instead of vanishing.
- **"I've made this one already"** (`components/plan/MadeAlready.tsx`, `POST
  /api/plan/<token>/made {item_id, made, url?}`) on every new-idea card: the
  card becomes **Repurpose** (`bucket='repurpose'`, old bucket kept in
  `made_from_bucket`, `made_at`, optional `made_url` = her post, Instagram/TikTok
  only), counts as a yes, and posts "I've made this one already — can you
  repurpose it? My post: …" on the thread → bot relays to MARKETING + OPS.
  Undo until `repurposed_at`. Console rows show "Their post ↗" / "Made already"
  beside the existing Repurposed ✓ tick. **Hint**: if her own post (any
  account) used the same non-original sound as the reference, the card says
  "You used this sound on <date>. Made this one already?" (`sound_used_on` in
  `planItemsFor`). Sound data is thin — 17 of her 282 posts, 32 of 67 cards —
  so the button, not detection, is the main path.
- **Film it = shot list from the video itself** (Geno approved all 4 steps).
  Mac: `src/shots.py` + `vendor/bin/look-frame` (Apple Vision, built by
  setup.sh from `src/look/look.swift`) — cuts, people per shot, framing, phone
  movement (edge-of-frame change), scene labels; keyframes in
  `out/<folder>/look/`. `./bin/look --apply` (live weeks first) →
  `transcripts.shots`. `./bin/look --describe` → `/api/worker/describe` →
  one line per shot + camera judgement from Mistral Small vision
  (`lib/describe.ts`). Both run in `bin/captions-nightly` AFTER captions;
  describe is skipped if captions hit the allowance. Card: `lib/shotlist.ts` +
  `ShotListView` replace Keep/Change/Face/Direction/Wardrobe/Camera/Takes/Sound
  and "What to say" when measured; unmeasured cards keep the old brief.
  Pilot: all 67 of Susanna's references measured 2026-09-27; review page
  https://claude.ai/artifact/57FiQDKj5YdKJ5b4Efhw6j. Vision lines need the
  deploy (the AI key is only on Vercel) and a night's allowance.
- **"How your plan works" removed** from every page (the card steps replace it).
- Tests: `node --import ./cloud/test/ts-resolve.mjs --test cloud/test/week-shape.test.ts`
  (same resolver file as the OnlyFans branch, identical content).

## 2026-09-27, late — read this first

**Where the code is.** GitHub `main` = production (last: scorecard wording fix
after `ffbbfae`). Built in a clean worktree, `~/projects/st-ui` (branch
`ui-simplify`, pushed as main), because **another session's "OnlyFans numbers"
feature** (`2370ae3`, needs `ANTHROPIC_API_KEY`, sends data to a model — Geno has
not approved it) sits **unpushed** on local `main` in `~/projects/social-transcriber`.
That checkout is behind GitHub: run `git pull --rebase` there first. Never ship the
numbers feature without Geno's say-so; deploy from a clean worktree while it is
in the tree. Bot (`~/gosian-bot`) is at `508a92f`, 457 tests.

Shipped late on the 27th (all live):
- **"N need attention" is clickable** on the dashboard → panel of who and why
  (`attentionReasons` in `lib/performance/math.ts`); tap opens their Analytics.
- **Repurpose from Analytics**: top reels at 2×+ her usual get a green
  ♻ Repurpose tag/button → card on her week (`bucket='repurpose'`,
  `plan_items.repurposed_at` null = "Needs repurposing"), file opens for the
  batcher. Editor ticks "Repurposed ✓"; her card then says it's in her group
  chat to post. `lib/repurpose.ts`, week rule shared in `lib/week-target.ts`.
- **Profile is videos, not text**: tabs now Profile · Analytics · Reels · Brand ·
  Blueprint · Week · Link. **Reels** = old Review + Editor as swipeable video
  carousels by grade (Winners get ♻ Repurpose), editor queue as video cards,
  Sunday call / quality / ladders folded away, **Plans sent + next due** on top.
  Tags live in Profile. Brand shows verticals as picture cards and creators as
  face badges (cover of their best library reel — no profile photos stored).
  `lib/reel-media.ts`, `/api/reels/media`, `/api/creators/faces`, `VideoStrip`.
- **Heat tab gone**: priority S/A/B/C + revenue High/Mid/Low are chips in the
  profile header; engagement score card on Analytics; sent weeks on Reels
  (`StandingTab.tsx` exports `StandingControls`, `StandingCard`, `SentWeeks`).
- **Weekly scorecard picture** to each model, **Monday 11:00 ET** (through Tue):
  `/api/plan/<token>/scorecard` draws a 1080×1350 PNG (next/og); bot sends it as
  a photo by URL. Honest trend + one next step (`nextStep` in
  `lib/performance/scorecard.ts`). Skips accounts under 50 followers (Ivy 0,
  Chelsea 5, Ria 23 — handles likely wrong). 19 due on 2026-09-28.
- **First live runs to watch Monday 2026-09-28**: 03:30 captions (3 weeks),
  10:00 daily archive (first ~75 reels), 11:00 scorecards (19), 12:00 shout-out
  roundups (9). Check OPS and `~/Library/Logs/social-transcriber-captions.log`.

## 2026-09-27, in short

Everything below is committed, deployed and pushed — transcriber `main` through
`a177e32`, bot (`~/gosian-bot`) through `603291b`.

**Telegram, both directions, through the Gosian bot** (the bot polls; it has no
web server). Bot routes use their own bearer secret: Vercel `GOSIAN_BOT_SECRET`
= Railway `TRANSCRIBER_BOT_SECRET`, plus Railway `TRANSCRIBER_URL`.
- *Send on Telegram* (`67f6679` / bot `e72e790`). Each model is linked to one of
  the bot's groups in her **Week tab** (bot `PUT /api/bot/groups` hourly; 26 of 27
  linked, not Jordan Jay). Plan editor Send = wording (weekly/weekend/short) +
  **Send on Telegram** (queued; bot posts like `/plan`) or **Mark sent — I sent it
  myself** (bot only records it for its day report). `plans.telegram_*` columns;
  `GET/POST /api/bot/outbox`. Never posts a week twice (`last_plan_id`).
- *Questions* (`411ba2b` / bot `ec21b92`). "Ask about this one" → her MARKETING
  topic **and** OPS (Geno: both), within a minute. `plan_messages.relayed_at /
  relay_error`; `GET/POST /api/bot/questions`; only the last 72 h, so linking later
  never floods. Before this **no model had ever used the box** — all DMs.
  Replies typed in Telegram do not come back onto the card.
- *Shout-outs* (`a177e32` / bot `c603520`), **automatic** (Geno's call).
  `lib/performance/shoutouts.ts`: her usual = median plays of her reels 8–60 days
  old (5+). Weekly roundup Mon 12:00 ET → Tue, last week's reels at ≥2× (best 3);
  instant note for a reel ≤72 h old at ≥5×, 10:00–20:00 ET, once per reel, one a
  day. Linked models only; nothing when nothing beat her usual; `shoutouts` table
  records each (failures too) so nothing repeats. First run: Kaytie + Mona instant
  on the 27th, 9 roundups Mon the 28th. Copy in the bot calendar `shoutouts`.
- **Orange hearts 🧡, never yellow 💛** in any bot copy (Geno).

**Dashboard** (`2e07c63`): the console's first and default tab; Queue moved last.
Totals, audience growth, leading accounts, Movement (up / steady / down), top
reels (plays inline while Instagram's link lives), views by day posted, sortable
accounts table. Each model's profile has an **Analytics** tab. Auto tag Top
performer / Average / Needs attention (`lib/performance/math.ts` `RULES`, pin
override `models.performance_tag`). Trends compare *settled* reels (7+ days) —
never calendar months. Follower history only from 2026-09-20. Story *views*
unavailable (only story days).

**90-day library** (`f4fc6ab`, `lib/expiry.ts`): age from the Instagram post
date (added date if unknown). Last 5 days tagged **⏳ Expiring · Nd**; at 90 the
daily cron (10:00 ET) **archives** (`jobs.archived_at`, never deletes).
Exempt: models' own reels, and anything on an open card (not filmed, not
declined, week not over). Library has **Expiring** and **Archived** shelves;
**Restore** in the item view. Archiving does **not** free the Mac's disk.

**Creator feedback fixes** (`d0eed5e`, from Scarlett / Madylina / Susanna):
- Every card opens with a big label: **New video / Recreate / Repurpose**
  (`cardKind` in `lib/card.ts`). Repurpose (console button) now also puts the
  card on her week (`bucket = 'repurpose'`): no filming directions, Save video first.
- Stock per-format captions removed ("read it twice" was on 33 of 50 of
  Susanna's cards); 696 cleared from 44 weeks. The caption engine may now **fill
  empty** captions on sent weeks (never rewrite); nightly run moved to **03:30**,
  **3 weeks a night** (`MAX_WEEKS`), logs Cloudflare's own error. 14 weeks queued.
- 3-step strip pinned on every plan; says **she films and edits herself** (Geno:
  we do not say we edit, not yet). Big filled green/red Yes/No. New decline
  reason **Needs another person** (permanent). Editor warns on repeated captions.
- Worst jargon lines reworded — only for *new* cards; stored directions keep old text.

**Tabs and filters wrap** instead of running off-screen (`add48e3`).


## 2026-09-26, in short

Pushed through `beda050`, deployed. Three things landed, one was investigated:

- **Recreate lands on the open week; one card can move weeks** (`beda050`).
  Recreate used to write to `currentWeekOf()` always, so late in a week the card
  landed on a plan about to end. Now the plan editor sends `plan_id` (the open
  week, must be a draft); the profile's Recreate (no week open) uses
  `workingWeek` in `lib/carry.ts` — latest draft week from this one on, else
  the Monday after the latest sent week ahead, else this week. Each card has a
  **Week →** menu (`POST /api/plans/<id>/items/move` `{item, week_of}`):
  any week from this one on, created if missing, card re-pointed so thread /
  accept / filmed come along, appended at the end, refused if that video is
  already on the target. `carried_from` is set **only** when the card leaves a
  *sent* week for a later one — standing counts carried, unfilmed cards as
  backlog, and moving a draft card is planning, not a miss. The editor opens on
  `openingWeek`: the newest week from this one on that has videos. The whole-week
  "Move to …" carry button is unchanged (past weeks only). Rules checked against
  real weeks (Faye → 28 Sep, Helwife → 5 Oct, Blair → 28 Sep); not clicked
  through in the console (needs Geno's login).
- **Delivery note names the channel** (`67c00ae`): default is now "…send them in
  the Telegram "MARKETING" channel." All 25 models' stored `delivery_note`
  updated in the database (22 had the old default; Blair, Milky, Susanna already
  had the new text). Live on every portal.
- **Comment-trends idea parked** (`f902818`) — see Ideas parked below.
- **Item 0 (Workers AI allowance) investigated, then put on hold by Geno.**
  Findings in Next, item 0.

Read this, then `docs/CREATIVE-DIRECTOR.md` (decisions + build order) and
`docs/CREATIVE-DIRECTOR-AUDIT.md` (the manual vs the code). The previous
handoff is archived at `docs/HANDOFF-2026-09-23-portal.md`; its decisions still
stand. Everything below is committed on `main`, deployed to
transcriber-ten-zeta.vercel.app, and **pushed** — the repo now has a private
remote, `github.com/sinaura-co/social-transcriber` (all three branches).

## Decisions taken (Geno, final)

- **No personal Instagram account in any automation, ever.** On 2026-09-25
  Instagram warned Geno's own account for automated behaviour: the downloader
  had been using its cookie for gated reels and pulled 62 in a burst. Nothing
  on this Mac acts as his account now. Anything that needs a login goes through
  a dedicated burner, slowly, in a real browser. He would take 95% avoidance
  over speed: "doesn't matter how long it really takes".
- **Captions come from the library's real captions**, not from the manual's
  formulas. Invented captions "are not using any type of Gen Z or modernized
  captions"; the 856 library reels already hold proven ones. The writer only
  adapts a real caption to her. Captions use **gpt-oss-120b** (~3¢ a week a
  model); the free 70B wrote nonsense.
- **DMs are written only on request.** Geno sends models the **portal link**,
  not a message per video. The console's "Write DM" button writes one card's DM.
- **Every model's creator type is set**: 23 women, Magnus a man.
- **Login alerts go to the Telegram OPS group** through the Gosian bot.
- The Symmetry Slogan formula is dropped (it wrote most of the nonsense) —
  moot now that captions are adapted, kept for the record.

## Built (7 commits, `2583161..c95e2d8`)

**The caption engine, rebuilt** (`cloud/src/lib/captions.ts`,
`caption-bank.ts`). Every card is offered 7 real captions: the source reel's
own caption first, then library captions from reels that beat their creator's
usual views ≥2× (same format first), through the topic gate. gpt-oss-120b picks
3 and adapts them — wording, casing, slang and emoji kept; code rejects any
where under 40% of the source's words survive, repeats a caption or a baited
comment already used that week, or uses a word wrong for the creator type.
Hashtags, @mentions, promos, non-English and Snapchat plugs are filtered out.
The console preview shows each option's real source. Magnus's week: 61 of 63,
all real. `POST /api/plans/<id>/write` `{captions, dry, model}` rewrites or
previews a week; model errors are reported, never swallowed.

**Captions nightly** — `bin/captions-nightly`, launchd
`com.geno.social-transcriber.captions` at **20:10**, ten minutes after Workers
AI's free allowance resets (00:00 UTC). Writes every draft week from this
Monday with uncaptioned cards, stops at the first 429, resumes the next night.
Log: `~/Library/Logs/social-transcriber-captions.log`.

**DMs on request** — `/api/dm/<card>` (console login), behind a Write DM → Copy
button on each card in the console preview.

**Brand tab accepted** for 8 models with real winners (Elizabeth, Jennzzxoxo,
Faye West, Magnus, Nina Dolci, Erica Diggs, Kaytie Benz, Milky Sins). Blair:
Thirst trap added to won't-do, nothing else.

**Her header** becomes an edge-to-edge square banner once stuck (both themes,
screenshotted live).

**The console crash** from the 2026-09-23 creator-type work is fixed:
`profile/form.ts` imported `lib/models.ts`, which drags the Neon driver into the
browser ("DATABASE_URL is not set" → "This page couldn't load"). Creator types
live in `lib/creator-type.ts` with no imports.

**Instagram, made human** —
- The downloader uses **no login** (`config.json` has no `cookies_file`, on
  purpose) and pauses 20–60 s between Instagram downloads.
- **The viewer burner** (`src/viewer.py`, launchd
  `com.geno.social-transcriber.viewer`, every 20 min): opens each reel the
  downloader could not fetch in real Chrome, home feed first, 6–14 s on a reel,
  1–3 min between, ≤5 a run / 15 an hour / 60 a day, 09:00–23:00 only, clear of
  Scout's passes. It reports the page's own video link to `/api/worker/viewed`
  (`job_media` table); the claim route hands that link to the worker, which
  fetches the file with no account. First login wall or warning → stops for the
  day, alerts OPS. `./bin/viewer --status` / `--check`.
- **`src/ig_browser.py`**: every Instagram browser — Scout's reader, the viewer,
  both sign-in windows — is the installed Google Chrome with an ordinary user
  agent, fixed viewport and locale. Verified: Chrome 153, `webdriver` false,
  brands "Google Chrome, Not_A Brand, Chromium".
- **Login alerts** (`bin/session-check`, launchd
  `com.geno.social-transcriber.sessions` 01:30/07:30/13:30/22:30, and from the
  worker on a login-type failure): proves each login, tells a dead login from a
  broken probe, posts to OPS on a change and daily while dead. The downloader
  now reports "off".

## State right now

- **Week of 2026-09-21, captions:** done with real captions — Magnus, Alexis,
  Chelsea, Elizabeth, Erica (5 of 20 models, plus 5 of Faye's cards).
  **15 weeks still have uncaptioned cards** (Faye's 15, and Helwife, Ivy, Jane,
  Jennzz, Jordan, Juno, Lae, Milky, Mona, Nina, Rey Rey, Scarlett, Snow,
  Sophia). **Still true at the end of 2026-09-25:** the first 20:10 run failed
  (`node: command not found` — launchd's bare PATH; fixed, `bin/captions-nightly`
  now finds node itself), and the manual rerun at 22:37 found the allowance
  **already used up**, 2½ hours after it reset. See Next, item 0.
  The free allowance ran out twice this session; Workers Paid ($5/mo) would
  remove the limit — **Geno's call, not taken**.
- 4 weeks sent (Blair, Kaytie, Madylina, Ria) — untouched; they keep the old
  captions they were sent with.
- **Nothing has been sent to any model by this system.** Every send was Geno.
- **Downloads:** 877 done. **35 failed** — 33 reels waiting for the viewer, plus
  two profile links (`bubbles.xxoo`, `golfgirlhaileyy`) that are not reels and
  never will download. `job_media` is empty: the viewer has not run yet.
- **The viewer burner does not exist yet.** Geno must create it on his phone,
  warm it up 3–5 days by hand, turn on 2FA, then `./bin/scout-login --viewer`
  and `./bin/viewer --check`. Steps in `docs/SCOUT-SETUP.md`. Until then the 33
  wait and nothing touches Instagram with a login except Scout.
- **Geno's own account** got the warning. He logged out on his phone. Advised:
  change password, 2FA, clear unknown sessions, then use it normally for days.
- **Scout's burner**: re-signed in 2026-09-25 02:43, SESSION ALIVE, now through
  real Chrome. Its login was overwritten once that night (see Traps) and put
  back; it is a different account from the downloader's.
- Creator types: 24 of 24. Brand accepted: 9 models have formats; 3 have
  won't-do (Blair, Milky, Ria).

## Next, in order

0. **Workers AI allowance — decided 2026-09-27: stay free, spread out** (done:
   03:30, 3 weeks a night, real error logged). Watch the first nights' log.
   Earlier findings, for the record — **investigated 2026-09-26.** Nothing
   else spends it. Cloudflare's GraphQL (`aiInferenceAdaptiveGroups`, by
   `modelId` and hour) shows only this project's caption runs: 09-23 17,731
   neurons, 09-24 none, 09-25 13,498 (all 04:00–07:00 UTC), 09-26 **zero** — yet
   the 22:37 EDT rerun and two 8-token probes got `429 / code 4006 "used up your
   daily free allocation"`. No other project on this Mac calls Workers AI.
   Best explanation, **unconfirmed**: the cap is a rolling 24 h, not a 00:00 UTC
   reset — the 09-25 spend was still inside the window at 22:37. Also: the cap
   overshoots (both big days went past 10k), so one heavy night can block the
   next. Options put to Geno, no decision yet: (a) stay free — probe once after
   ~07:00 UTC to confirm, move the nightly to ~03:30 local, cap a night at ~8k
   neurons, 15 weeks over ~4–5 nights; (b) Workers Paid $5/mo, 15 weeks ≈ 40k
   neurons ≈ 35¢ past the included 10k. Either way `bin/captions-nightly`
   should log Cloudflare's real error text — today it prints only "allowance
   used up". Don't act on this until Geno says.
1. **Read the caption log** after 20:10 (`~/Library/Logs/social-transcriber-captions.log`)
   and spot-check two weeks in the console preview. If it stopped at the
   allowance, the rest runs the next night.
2. **When Geno says the viewer burner is signed in**: `./bin/viewer --check`,
   then watch `./bin/viewer --status` and the viewer log for the first few
   reels before trusting it. The claim route's `job_media` join is untested
   against a real viewer link.
3. ~~Niche strength on the Brand tab~~ — **built 2026-09-25** (`lib/niches.ts`):
   per niche, creators with a reel ≥5× their median in the last 90 days, of
   how many we watch, top handles; her own accounts excluded. Only Kaytie
   (golf 2/5) and Mona (trivia 3/6) have niches of their own; everyone else
   sees the strongest niches we watch (food 11/13, gym 6/7). Information, not a
   verdict. Gate C is not to be built as written; Gate A waits on the allowance.
4. **Blair's re-shoots ignore won't-do.** `match.ts` excludes won't-do formats
   for new ideas (`NOT_REFUSED`), but her own winners queued as reskins are not
   checked, so her other thirst-trap winners can still reach her. Ask Geno.
5. **Magnus's three hook-axis cards** change "the opening line" with no line on
   file. The ladder should pick a different variable when the hook is unknown.
6. **The Brand tab says "her biggest account"** for Magnus — copy assumes women.
7. **Console theme**: in Playwright the console rendered dark with
   `color_scheme='light'`. Unconfirmed whether that is by design.
8. Walk 2–3 models' weeks with Geno before anything is sent.

## Open after 2026-09-27

- **Susanna's won't-do is empty** — she films solo or with her husband. Asked
  Geno whether to add couple/group formats; no answer yet. The app cannot tell
  people-on-camera (only voices); a people tag needs AI tagging.
- **Plain-language rewrite (spec item A)**: What to do / You'll need / Time, the
  rest behind "More details"; rewrite stored directions too.
- ~~Effort badge + easiest-first sort (spec F)~~ — **built 2026-10-06**
  (`lib/effort.ts`, pure + tested): every filming card carries a Quick one /
  Medium / Bigger shoot chip scored off the measured video (cuts, setups,
  phone handling, people, her own lines — borrowed-sound words don't count —
  screen text, length; format-tag fallback for unmeasured). The week renders
  in **filming sittings** — "No talking — text goes on top" / "Talking to the
  camera" / "Skits & bigger shoots" — quickest sitting first with a "Start
  here" nudge, easiest card first inside each. Presentation only: positions,
  card numbers, stored order untouched; a one-sitting week falls back to the
  old location grouping. Also fixed: light theme painted group bars white but
  left the name cream (`--sc-bone`) — invisible; dark had its override all
  along. **Upload in the app** (G) still deferred.
- **Archive frees no disk** — the Mac's files stay; separate work if wanted.
- Restored library items re-archive at the next daily pass unless put on a week
  (offered Geno a "stay restored" option; no answer).
- Nobody has sent a real question or received a real Telegram plan yet — watch
  the first ones.

## Ideas parked (not scheduled — ask Geno before building)

- **Trends AI / Discovery tab** (Geno, 2026-10-06). A "Trends AI" search box in
  a new Discovery tab: ask "what's trending today?" in plain English, answers
  grounded in real trend data. Data plan agreed in discussion: (1) Google's
  official BigQuery public Trends dataset — top 25 + rising terms daily, 5 y
  history; (2) the free Trending Now RSS feed for today's trends; (3) monthly
  cached interest-over-time curves for our ~15–20 fixed niche topics via the
  unofficial Explore endpoints (fixed list only, never arbitrary real-time);
  skip paid SerpAPI unless free path falls short. Nightly ingest →
  `trends_*` tables in Neon → chat panel cross-references Google's rising
  terms with the library's own cross-creator breakouts and trending sounds
  (Scout's stored `audio_id`/`audio_title`). Chat layer wants the Anthropic
  key (same key decision as the OPS /q deploy). Deliberately parked for
  higher-priority builds — ask Geno before starting.
- **Comment trends** (Geno, 2026-09-26). Read the comment sections of the
  library's posts — what viewers write, followers or not; **not** the post's
  own caption, and leave out the account owner's own replies — and surface
  what repeats: frequent comments, common sayings,
  trending words, meme phrases, and the sounds/audios behind them — to steer
  what the next video is. Today Scout keeps only `comment_count` and the audio
  (`audio_id`, `audio_title` in `src/scout_ig.py`), not comment text. Reading
  comments means more Instagram reads: burner only, through `ig_browser.py`,
  within the viewer/Scout pacing — never a personal account. Audio trends can
  start from what Scout already stores, with no new reads.

## Traps

- **No personal Instagram account in any automation.** Not the downloader, not
  a probe, not a "quick test". Burners only, only through `ig_browser.py`.
- **Three Instagram cookie files, never swap them.**
  `secrets/scout-cookies.txt` = Scout's burner. `secrets/viewer-cookies.txt` =
  the viewer burner. `secrets/cookies.txt.retired-2026-09-25` = Geno's own,
  retired. `./bin/scout-cookies` writes **Scout's** file unless given `--path`;
  `./bin/scout-login` writes Scout's, `./bin/scout-login --viewer` the viewer's.
  On 2026-09-25 another Claude session told Geno to drop `--path`, and the
  downloader's cookie overwrote Scout's working login. Check with an account-id
  fingerprint (`ds_user_id` → `shasum`), never by printing a value.
- **yt-dlp writes its cookie jar back.** A dead session saves the file without
  `sessionid`, silently. Probe with a *copy* of any jar.
- **Pasting commands into Claude Code:** Geno's paste splits long `!` commands
  across lines, and `pbpaste` reads whatever he copied last. Give one-line
  commands and say in what order to copy.
- **The Mac's shell is zsh.** `set -- $var` and `$(...)` do not word-split;
  a loop written for bash silently does nothing (a whole caption run fired at
  malformed URLs this way). Write loops as bash scripts.
- **Deploys:** `npx vercel deploy --prod --yes` from `cloud/` only — from the
  repo root it links a different project (`social-transcriber`) and tries to
  upload 20k files. It sometimes answers "Not authorized" once; retry works.
  `config.json`'s `cloud_url` is the team alias, which lags the deploy by
  seconds.
- **SQL is invisible to typecheck and build.** A union takes its column names
  from its first branch; unnamed `null::text` columns there broke every job
  hand-off (`/api/worker/claim` 500, "column m.caption does not exist") from
  the viewer deploy until Geno's links arrived that evening — 7 reels sat
  "running". Run any changed query against the database (`scripts/_q.mjs`)
  before deploying, and after a claim-route change watch one job go through.
- **launchd jobs get a bare PATH** (`/usr/bin:/bin:…`): `node` lives in
  `/usr/local/bin` and is not found. Scheduled scripts must resolve tools
  themselves; test one with `env -i HOME=$HOME PATH=/usr/bin:/bin ./bin/<it>`.
- **Console copy is they/their** (2026-09-25, Geno): the roster is not all
  women. New console text must not say her/she. Her portal says "you".
- **Anything a client component imports must not import `lib/db.ts`**, even
  transitively. `npx next build` then grep `.next/static` for
  "DATABASE_URL is not set" proves it.
- **Workers AI free allowance** is 10,000 neurons a day, shared with the Whisper
  fallback — documented as reset 00:00 UTC, but see Next item 0: it behaved like
  a rolling 24 h on 2026-09-25/26. Dry runs and comparisons spend it too.
- **Reading Workers AI usage:** wrangler is logged in as the account
  (`npx -y wrangler@4 whoami` refreshes the OAuth token in
  `~/Library/Preferences/.wrangler/config/default.toml`); that token can query
  `https://api.cloudflare.com/client/v4/graphql` →
  `viewer.accounts(accountTag).aiInferenceAdaptiveGroups` with
  `sum{totalNeurons}` and `dimensions{modelId datetimeHour}`. Never print it.
- **The database schema is `transcriber`** (`transcriber.models`,
  `transcriber.plans`, …). `scripts/_q.mjs "select … from models"` fails with
  "relation does not exist".
- **Two sessions can share this folder.** On 2026-09-27 another session was
  building a "numbers"/audits feature here while this one shipped. Never
  `git add -A` — add your own files by name. `vercel deploy` uploads the folder
  as it is on disk, uncommitted work included: when someone else has work in
  progress, deploy from a clean `git worktree` of HEAD (copy `cloud/.vercel` in;
  do not symlink `node_modules` — Turbopack rejects it; Vercel installs its own).
- **Bot integration is poll-only.** Each bot tick reads `/api/bot/outbox`,
  `/api/bot/questions`, `/api/bot/shoutouts` and answers each item; every answer
  is recorded so nothing repeats. Never run the bot locally (`npm start` double-
  sends). Bot copy lives in its calendar, not code; orange hearts only.
- **Card kind is derived, not stored**: `cardKind(bucket, source_post)` — her own
  reel = Recreate unless `bucket = 'repurpose'`; everything else = New video.
- **Shout-out / ET day boundaries** use real New York midnight (`easternMidnight`),
  not a fixed UTC offset.
- **Moving cards:** one card → `items/move`; a whole past week → `carry`. Both
  re-point `plan_items` rows; never copy. Only `carry` and a move off a *sent*
  week set `carried_from` (it feeds standing's backlog).
- `--sc-bone` is the page **ground** and night inverts it. Never use it for
  type on the ink header — use `--plan-on-ink`.
- Prefixing a dark rule with `:root[data-theme='dark']` **raises its
  specificity** and can beat a state rule (`[data-on]`, `:active`).
- `globals.css` still inverts tokens from the OS, guarded by
  `:root:not([data-theme])`. The console follows the Mac; her plan follows her.
- **Screenshot both themes before claiming a theme change works.**
  `.venv/bin/python` + Playwright, `color_scheme`, `localStorage.sinaura-theme`.
- Half the library stores reel URLs with **no trailing slash**; match a
  shortcode with `jobMatchesCode` in `lib/sql.ts`, never `like '%/CODE/%'`.
- `/api/thumb` needs a console session. Her portal uses
  `/api/plan/<token>/thumb/<job>`, which checks the reel is hers.
- `/api/retag?all=1` only ever does the newest 400 rows. It cannot page.
- Local `.env.local` cannot hold `CLOUDFLARE_AI_TOKEN`; test AI routes against
  production (same database).
- **Never two browsers on one burner at once.** Scout's passes are 19:00 daily,
  Saturday 10:00 and 16:00; the viewer and session check keep clear of them.
- **Restart the worker** with
  `launchctl kickstart -k gui/$(id -u)/com.geno.social-transcriber.worker`,
  never by PID. It runs old code until restarted.
