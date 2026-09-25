# Handoff — 2026-09-23, the portal and the planner's second night

Read this, then `docs/CREATIVE-DIRECTOR.md` (decisions + build order) and
`docs/CREATIVE-DIRECTOR-AUDIT.md` (the manual vs the code). Everything below is committed on `main` and deployed to
transcriber-ten-zeta.vercel.app.

## Decisions taken tonight (Geno, final)

- **A reel she turned down does not come back.** Not comfortable / not the
  right outfit / something else are **permanent**. Nowhere to film and no time
  come round once more after **21 days**. "Something else" must carry her
  words — her phone holds the save until it does.
- **Every model has a creator type**: woman, man, trans woman, trans man,
  non-binary, couple, or not set. It feeds the caption writer and nothing else.
  Unset means the writer uses no gendered words at all.
- **A reel about a subject only goes to a model in that subject.** Topic is a
  gate, not a bonus. `relatable` and `unknown` pass to anyone.
- **Relatable reels are capped at 2 a week** and carry the twist instruction.
- **Light or dark is hers**, not her phone's. Dark stays as it was.

## Built tonight (23 commits, `25f3f4a..e07755d`)

**The download hole closed.** Her winners had no fallback file, so 28 of 65
failed. The roster pass now keeps each reel's CDN link (`creator_posts`), the
claim route matches unlinked jobs by shortcode, and a pass that brings fresh
links **re-queues failed downloads by itself** — 21 healed on the first run.
`bin/scout --roster` is scheduled Saturdays 16:00 (launchd
`com.geno.social-transcriber.roster`) and queues every model's winners after it.

**The topic axis.** Fourth tag axis beside persona/format/hook: 17 niches plus
`relatable` and `unknown`, keyword-tagged. All 825 library reels tagged
(51 golf, 138 relatable, 523 unknown). A model's niches are read off her own
reels — Kaytie → golf, Mona → trivia. Matching gates on it.

**Her portal.** Sun/moon theme toggle (writes `data-theme`, remembered on her
phone, resolved before first paint). **Your run** sheet: her best reels as a
snapping carousel with stills, her multiple of her own median, flame on
winners past 10x, and "kept up" as seven days. The header now sticks,
condenses, tucks away on a chevron and returns by itself at the top.

**Recreate / Repurpose** on any of her winners, from the profile strip and the
week editor: put it on her week as a control reskin, or download the file and
mark it ours to repost (trial reels by default). The Editor queue hands over
the clip itself.

**Scout can be signed in on the Mac** — `./bin/scout-login` opens Scout's own
browser window. Untested; the phone method still works and is documented.

## State right now

- Week of 2026-09-21: **318 cards across 20 models, all draft**. 4 sent
  (Blair, Ria, Madylina, Kaytie — the last two sent by Geno with the older
  card text; Kaytie's week he then did by hand).
- **Nothing has been sent by this system.** Every send so far was Geno.
- 58 of 65 winners downloaded. **7 still fail**: older reels the roster pass
  does not reach (Jennifer 908x and 118x, Magnus 11x/9.3x, Mona 3.8x).
- 5 declines on file, all Blair's. 3 permanent, 2 back on 2026-10-11.
- 1 model has a creator type set (Magnus = man). **23 to go.**
- 0 of 24 models have accepted verticals, creators or topics in the Brand tab.

## Next, in order

1. **The caption engine.** DMs are good and I would send them. Captions
   collapse onto three shapes — with the honest filters on, only 19 survived
   across Magnus's 21 cards. Fix: write the whole week in **one call** so the
   model sees all 21 cards at once. Alternatives were: accept 1-2 per card, or
   pay for a stronger model. Magnus's week is written and is the test case
   (`plan_id qANZZotU6LId`, `POST /api/plans/<id>/write`, worker secret or
   console).
2. **Set creator types** for the other 23 models (Models → a model → Profile →
   "Who the creator is"), then rewrite captions.
3. **The Brand tab**: accept verticals, creators and won't-do per model. Her
   three "not comfortable" declines should seed Blair's won't-do.
4. **Magnus's three hook-axis cards** change "the opening line" with no line on
   file. The ladder should pick a different variable when the hook is unknown.
5. Walk 2-3 models' weeks with Geno before anything is sent.

## Traps

- `--sc-bone` is the page **ground** and night inverts it. Never use it for
  type on the ink header — use `--plan-on-ink`. This is what made YOUR RUN
  black on black.
- Prefixing a dark rule with `:root[data-theme='dark']` **raises its
  specificity** and can beat a state rule (`[data-on]`, `:active`) that used to
  win inside the media query. That greyed out every filmed segment.
- `globals.css` still inverts tokens from the OS, guarded by
  `:root:not([data-theme])`. The console follows the Mac; her plan follows her.
- **Screenshot both themes before claiming a theme change works.**
  `.venv/bin/python` + Playwright against the live URL, `color_scheme='dark'`,
  `localStorage.sinaura-theme`. Two bugs got past a deploy check that way.
- Half the library stores reel URLs with **no trailing slash**; match a
  shortcode with `jobMatchesCode` in `lib/sql.ts`, never `like '%/CODE/%'`.
- `/api/thumb` needs a console session. Her portal uses
  `/api/plan/<token>/thumb/<job>`, which checks the reel is hers.
- `/api/retag?all=1` only ever does the newest 400 rows. It cannot page.
- Local `.env.local` cannot hold `CLOUDFLARE_AI_TOKEN`; test AI routes against
  production (same database).
- Never run two browser passes on the burner at once.
- **Two Instagram logins, two files, never swap them.** `secrets/cookies.txt`
  is the downloader's own account (yt-dlp); `secrets/scout-cookies.txt` is
  Scout's burner. `./bin/scout-cookies` writes Scout's file unless given
  `--path secrets/cookies.txt`; `./bin/scout-login` only ever writes Scout's.
  On 2026-09-25 the downloader's cookie was saved over the burner's by leaving
  `--path` off.
- **A dead downloader login is silent.** yt-dlp saves the jar back without its
  `sessionid` and every gated reel fails "could not download … tried
  anonymously, then with cookies" — 62 did, 2026-09-22 → 25.
  `./bin/session-check` (launchd `com.geno.social-transcriber.sessions`,
  01:30/07:30/13:30/22:30) proves both logins and posts to the Telegram OPS
  group through the Gosian bot (`secrets/alerts.json`) on a change, daily while
  dead. The worker also runs it when a download fails with cookies.
  `--test-alert` proves Telegram; log at
  `~/Library/Logs/social-transcriber-sessions.log`.
- **No personal Instagram account in any automation, ever.** On 2026-09-25
  Geno's own account (the downloader's cookie) was warned for automated
  behaviour after 62 downloads in a burst. `config.json` has no `cookies_file`
  on purpose; the old jar is `secrets/cookies.txt.retired-2026-09-25`. Reels
  that need a login go to the **viewer burner** (`src/viewer.py`,
  `docs/SCOUT-SETUP.md`), which reports the page's own video link to
  `/api/worker/viewed`; the worker fetches the file from the CDN with no
  account. Instagram downloads are paced 20–60 s apart (`INSTAGRAM_GAP_SEC`).
- Scout's reader (`scout_browser.py`) still launches Playwright's headless
  Chromium with its default user agent, which says "HeadlessChrome". The viewer
  uses installed Chrome with an ordinary UA; Scout should get the same.
