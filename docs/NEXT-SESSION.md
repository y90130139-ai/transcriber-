# Handoff — 2026-09-19, end of the Scout build

Read this, then `docs/SCOUT.md` (the account of everything below), then the
project memory. `docs/GAME-PLAN.md` is still the strategy; stages 1, 2, 3, 4
and 6 of its loop are now shipped.

Everything here is committed on `main` and deployed. Working tree clean at
`6e4cc55`.

---

## What exists now that did not this morning

**Scout** — the watchlist sweep that ended hand-pasting. Vercel cron (Sat
10:00 ET) starts an Apify run; Apify webhooks the results to
`/api/scout/apify-hook`, which stores every reel as a *sighting*, measures each
against its creator's own median plays, and queues the winners into the same
job queue a paste uses. Sunday the same cron drafts every model's week (also
10:00 ET — see item 3; 17:00 is the Mac's fallback copy). The Mac is not
involved in either.

**Failover** — `/api/worker/cloud` stands in when the Mac's heartbeat has been
silent 90 minutes: transcribes through Cloudflare Workers AI and pushes plan
videos to R2 with a presigned PUT. Verified by stopping the worker: 24 reels
transcribed, Mac restarted, failover stood down by itself.

**Badges** — `lib/appeal.ts` replaced "8.53×" with *Blowing up · 1.2M views*,
from measured thresholds. Her card shows one line; the console keeps the
numbers on hover.

**Watchlist + sounds + profiler** — bulk-add creators, collab suggestions,
rising-audio strip, and a vision profiler that proposes each creator's persona
for one-tap approval.

Numbers as of tonight: **196 watched creators** (72 gated, 19 suggested),
**3,008 sightings**, **648 library items**, 0 queued, 0 failed, 18 creators
with a persona, 20 proposals waiting.

---

## Do these first

### 1. Geno's burner session — 72 gated creators are dark

Over a third of the watchlist cannot be read logged out (measured: 97 of 194
reels refused an anonymous fetch). The gated sweep is built and scheduled
(`com.geno.social-transcriber.scout`, Saturdays, `--only burner`) and does
nothing until `secrets/scout-cookies.txt` exists.

Geno has the throwaway account ready (created a month or two ago, which is
good — aged accounts get challenged less). He needs to paste the `sessionid`
cookie from DevTools on **a separate Chrome profile signed into only that
account**; `./bin/scout-cookies --sessionid '…' --csrftoken '…'` writes the
jar. Then `./bin/scout --check-burner <a gated handle>` proves it, and
`./bin/scout --only burner --limit 10` proves the pass.

Full walkthrough: `docs/SCOUT-SETUP.md`. **Raise this at the start of the
session** — it is the single biggest gap left.

### 2. Finish the persona proposals — blocked on neurons, not code

`./bin/profile-creators` loops the profiler until nobody is left. Tonight it
stopped with:

> you have used up your daily free allocation of 10,000 neurons

That is ~23 creators of vision calls a day. 120 of the 178 untagged creators
have usable frames right now. Two ways on, Geno's call:

- **Wait** — but the reset is not reliably 00:00 UTC. Cloudflare's docs say
  "all limits reset daily at 00:00 UTC"; measured against this account, the
  route still returned `429 … used up your daily free allocation` at both
  **00:32 and 01:02 UTC** on 2026-09-20, an hour past that boundary. So the
  documented hour is not what this account behaves like — expect a lag of
  unknown length, and probe rather than schedule.
- **Pay** — and the real figure is **$5/month, not $1**. Exceeding the free
  10,000 neurons/day is not a billing toggle: it requires the **Workers Paid
  plan, $5 USD/month minimum** (Cloudflare's own Workers pricing page). The
  $0.011 per 1,000 neurons is what you pay *on top* of that, and the remaining
  watchlist is roughly $1 of neurons. The 429's wording ("please upgrade")
  says this account is on Workers Free today.

  $5/month buys more than the profiler: the same plan raises the Workers
  allotments that **Whisper failover** draws on, which is currently sharing
  that one free 10,000/day with the profiler. If the $5 is worth it at all,
  it is worth it for the failover headroom, with the profiler as the occasion.

`bin/profile-creators` used to spin through all 500 rounds against that wall —
the route keeps reporting `more`, so an exhausted allowance looked like work
left to do. It now stops on the first round that profiles nobody, and names the
allowance when that is the reason.

**Careful:** Whisper failover shares that same daily allocation. If the Mac is
down, leave the profiler alone — transcription matters more.

### 3. Watch the first unattended run — it is Sunday morning, not Saturday

Corrected after checking the registered cron. It is one Vercel cron,
`/api/cron/daily` on `0 14 * * *`, **14:00 UTC — 10:00 EDT**, enabled and
pointed at the current production deploy. So:

- **Sat 2026-09-19 did not sweep.** The cron was deployed hours after 14:00 UTC
  had already passed. The five runs in `scout_runs` that evening were hand-fired.
- **Sun 2026-09-20, 10:00 EDT** is the first unattended fire: the autodraft
  branch (`weekday === 0`). This is the one to watch tomorrow morning.
- **Sat 2026-09-26, 10:00 EDT** is the first unattended sweep.
- The docs elsewhere say "Sunday 17:00". That hour belongs to the *Mac's*
  `com.geno.social-transcriber.autodraft` launchd job, which still fires. Both
  drafters running is harmless and now verified so: `previewBatch` computes
  `wanted = weekly_target - already`, so the 17:00 pass finds the week already
  full and writes nothing. It is a fallback, not a duplicate.
- `0 14 * * *` is pinned to UTC, so when the US leaves DST on 2026-11-01 both
  jobs slide to **09:00 ET**. Nothing breaks; it is just an hour earlier.

Check `transcriber.scout_runs` and `~/Library/Logs/social-transcriber-scout.log`.

Apify spend is **$12.08 of the $19 Starter allowance** with 11 days left in
the cycle; a weekly refresh is ~$4. If it overruns, cut `REFRESH_DAYS` 17 → 12
in `cloud/src/lib/scout-apify.ts`.

---

## Then, in Geno's own order of interest

1. **Interface** — he has said twice he wants the console cleaner, and admins
   eventually ("not right now"). The Creators tab now stacks three panels
   above the grid; that is the first thing to look at.
2. **`hot.ts` from sightings.** It still divides by the median of *kept*
   posts, which runs high, and it is still engagement-based while everything
   new is plays-based. Do not change the score and its input in the same step —
   that rule is why it has been left alone so far.
3. **Sweep our own models' accounts.** The same reader gives plays on *her*
   posts: stage 7 (measure) without the Meta app. It cannot give saves or
   watch time — only Insights can.
4. **TikTok radar (phase 2, agreed).** `tiktok:user` works in the vendored
   yt-dlp and costs nothing; trends land there 1–3 weeks before Reels.
5. **Feed the model's own verdicts back into `match.ts`** — "I'll do this" /
   "Can't do this" is collected and still unused.

---

## Traps this session earned

- **`vercel env add` did not trigger the implicit `env pull`** that store
  commands do — `.env.local` was byte-identical before and after, checked
  every time. Keep checking.
- **Vercel Hobby crons are daily-only**, so one `/api/cron/daily` decides by
  weekday which job is due. `after()` chaining works for the fallback but
  **proved unreliable for long profiler chains** — that loop belongs on the
  Mac (`bin/profile-creators`).
- **Instagram's CDN serves datacenters fine** even though its site blocks
  them. That single fact is why cloud failover is possible at all.
- **`@cf/meta/llama-3.2-11b-vision-instruct` needs Meta's licence accepted**
  by the account owner (403 until then). Mistral needed nothing.
- **Bios are empty in this niche** — 148 of 196 exist and say "check
  highlights ↓". Do not build anything that leans on them.
- **Only 57 of 196 creators are professional accounts**, so
  `business_discovery` was never going to cover this watchlist. That question
  is closed.
- **CSS tokens** are `--sc-ink-900/700/500/300/150`, `--sc-bone`,
  `--sc-ember`, `--sc-rule-hair`. There is no `--sc-ink` or `--sc-ink-100`;
  inventing them fails silently.
- Screenshot recipe that works is in `docs/SCOUT.md`; smoke-test `/p/<token>`
  only with a week that is already opened, or it fakes `plans.opened_at`.
