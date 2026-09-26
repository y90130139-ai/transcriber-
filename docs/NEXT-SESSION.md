# Handoff — 2026-09-25, captions from the library, and Geno's account out of the machine

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

0. **Find what spends the Workers AI allowance.** It reset at 20:00 EDT on
   2026-09-25 and was gone by 22:37, before any caption call. Not the cloud
   fallback (the Mac's heartbeat was fresh), not opening a profile (the persona
   profiler runs only on its button). Check the Cloudflare dashboard → Workers AI
   → usage by model. Until found, the nightly captions may never get a turn — or
   take the $5/mo Workers Paid plan (Geno's call).
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
  fallback, reset 00:00 UTC. Dry runs and comparisons spend it too.
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
