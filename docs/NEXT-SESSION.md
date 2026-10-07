# 2026-10-06 (later): Trends tab, Baby pink, the week in two piles

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
