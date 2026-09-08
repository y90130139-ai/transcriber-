# Handoff — automated ingest, views, intake forms, hands-off weeks

Written 2026-09-08. Geno's goal, in his words: *"Keep the manual out of this."*
He wants new uploads landing in the library on their own, tailored to each model
automatically, with a weekly page he only reviews and sends. Target: this
weekend. Scale target: 100 models.

Read `docs/REBUILD.md` first (now at `docs/REBUILD.md`, also on his Desktop),
then the project memory. This file is the delta.

## State, verified 2026-09-08 — do not re-derive

- **18 models**, 102 creators, 220 transcripts, 221 jobs, **100% Instagram, zero
  TikTok.** Every doc older than this says "roster is 1 (Test Dummy)". Wrong.
- The repo **is** under git now (`8ab5af8`, branch `main`, no remote).
- `pov-relatable` shipped 2026-09-06. Do not rebuild it.

## The one blocker, and what is actually downstream of it

**Instagram has no proven free route for (a) listing a creator's new uploads or
(b) reading view counts.** Both were tested on this Mac 2026-09-08:

| Test | Result |
|---|---|
| `yt-dlp --list-extractors` | `instagram:user` **CURRENTLY BROKEN**; `tiktok:user` works |
| `yt-dlp --simulate` on a real IG reel, with cookies | `likes=12 comments=0` but **`views=NA plays=NA`** |
| `tiktok:user` flat listing | works, returns views+likes+comments, no download |
| logged-out IG `web_profile_info` on 10 real handles | HTTP 400 ×10; **control run was blocked, so "endpoint closed" is UNVERIFIED** |

**`business_discovery` solves both at once** — it returns `like_count`,
`comments_count` *and* `view_count` for other professional accounts. So views
and auto-discovery are one decision, not two.

Its constraints, from Meta's docs: professional accounts only; **age-gated
professional accounts explicitly excluded** (the likeliest killer for this
niche); needs a FB Page + IG professional account + Meta app + **App Review**,
which takes days to weeks and is outside our control; ~200 calls/hour. It
returns the *signal, not the video* — "a GET on any returned IG Media will fail
due to insufficient permissions." That is fine: discover via API, fetch via the
Mac, exactly as now.

**Unblocking step, five minutes, Geno's to do:** look at ten handles from
`transcriber.creators` and count how many show a category label ("Digital
creator", "Public figure") — those are professional. If most do not, the free
route is dead and this becomes a paid-provider decision. Everything in Track B
waits on that number.

## HARD LIMITS — tell him plainly, do not promise these

Geno asked for saves/bookmarks, watch time, retention, and "how quickly somebody
views a video". **None of these exist for other people's content, by any route,
free or paid.** They are Insights metrics, available only for accounts you own
or manage. Third-party tools *estimate* them; they do not have them. Any plan
that assumes competitor watch-time is built on sand. What IS obtainable for
other accounts: likes, comments, and — via `business_discovery` only — views.

## Track A — ships regardless of the blocker. Do this first.

This is most of his manual pain and none of it is gated on Meta.

**A1. Explain the multiplier in the UI.** He said: *"it shows X1.3 and X0.02 and
I don't quite understand what that is."* That is `hot.ts` outperformance —
score ÷ that creator's own median, where `score = likes + 10 × comments`. ×1.3 =
30% above that creator's normal; ×0.02 = a dud at 2% of normal. **He has been
reading his single best signal without knowing what it means.** Put a tooltip
and a legend on it. Cheapest win in the whole file.

**A2. Auto-draft every model's week on a schedule.** `BatchWeek` already builds a
week for everyone; today a human clicks it. Run it on a cron/launchd timer into
**draft** status. Safe by construction: `plans.status` draft|sent means she sees
nothing until he sends. This alone converts his week from "build 18 plans" to
"review 18 pages and hit send" — the exact workflow he asked for.

**A3. Intake form → model profile → tags.** New build. He wants to dump a file
into a model's profile and have it shape what she gets. Vercel Blob upload
already exists for phone uploads; reuse it. Parse the form, map answers onto the
existing taxonomy (`formats`/`hooks`/`persona`/`wont_do` on `transcriber.models`
are already uncapped and already drive `match.ts`). **Rule-based mapping, not a
model** — constitution rule 3. A checkbox list on the form maps to tag ids
directly; freeform prose should map through the same whole-word lexicon
discipline, and map to nothing when unsure rather than guessing.

**A4. Engagement-ratio gate, built but dormant.** Write the ratio logic and the
filter now against `likes/views`; it stays inert until views exist. His instinct
is right: 20k views with 10 likes is ~0.05% engagement — bought or dud. Do NOT
invent a threshold; measure the corpus distribution once views land, the way
every other constant in this project was set.

## Track B — blocked on the five-minute answer above

**B1. Watchlist poller.** One stage. For each creator: list recent posts,
metadata only, no download. Gate on the existing `hot.ts` bar. Enqueue only what
clears it, through `source_key` so re-polling never duplicates. **Two-phase is a
rule:** cheap sweep first, full transcribe/OCR only on winners — download
everything and you fill `out/` (already 1.7G) and get blocked.

**B2. Views column + backfill.** Additive migration, populate from whichever
source B0 settles on. `hot.ts` scoring stays as-is until there is enough view
data to re-tune against; changing the score and adding the input at the same
time makes both unmeasurable.

**B0. The source decision itself.** business_discovery (free, App Review, may
exclude the niche) vs paid provider (works, monthly cost, no review) vs
TikTok-only (free today, serves 0% of current corpus).

## Traps carried forward

- **Spend nothing without asking.** Never run a `vercel` store or env command —
  implicit `env pull` overwrites `cloud/.env.local`. `vercel deploy --prod` only.
- `$WORKER_SECRET`/`$CLOUD_URL` are **not** shell vars — they are `worker_secret`
  and `cloud_url` in `config.json`. Auth 401s silently otherwise.
- Worker is launchd `com.geno.social-transcriber.worker`, KeepAlive. Never kill
  by PID and start another — two tunnels fight and return HTTP 530. Restart:
  `launchctl kickstart -k gui/$(id -u)/com.geno.social-transcriber.worker`.
- **Automated polling risks the account behind `secrets/cookies.txt`**, which
  gated-post fetching depends on. Low frequency, and prefer the official API.
- Any free scraping route is a permanent maintenance liability — `instagram:user`
  being broken right now, in a tool already vendored here, is the illustration.
- Verify by screenshotting (`docs/rollback/cdpshot.mjs`), both themes. This
  project has shipped broken layouts twice by reasoning about markup.

## Honest timeline

Track A is 2-3 focused sessions and has no external dependency — it can be done
this week. Track B's code is 1-2 sessions; its *blocker* is Meta App Review,
which is days to weeks and cannot be compressed by anyone. **A fully automatic
Instagram ingest by this weekend cannot be promised.** Track A landing this week
is realistic and removes most of the manual work he described.

Build cost is real: recent sessions ran $114, $160, $211, and 2026-09-08 hit ~$30
on research alone. Budget the build, and per [[cost-guard-preference]] hand off
to a fresh session rather than pushing through a guard.

---

## Addendum — the one idea from the Amor Content Vault teardown (2026-09-08)

Source: `~/Desktop/AmorContentVaultTeardown.md`, a gosian teardown of
amorcontentvault.com. Its own sections 8-9 already do the comparison correctly
and the conclusion is right: **do not rebuild Amor.** Almost everything it
flags as a defect is already solved better here.

**Verified already handled in this build — do not "add" these:**
- Its P0 (indexable private site) is a non-issue here. Checked live
  2026-09-08: the app emits a global `<meta name="robots" content="noindex">`
  and `cloud/src/app/p/[token]/layout.tsx:7` sets
  `robots: { index: false, follow: false, nocache: true }` on the creator
  portal specifically. No robots.txt, but the meta tag does the job.
- Shared email+password → we use revocable per-creator tokens with no login.
- Saves trapped in `localStorage` → we have server-side per-item state.
- No feedback loop → we have two-way per-card threads, verdicts, filmed marks.
- Hotlinked thumbnails that rot → we mirror posters and R2 the plan videos.

**The gold, and it is one thing.** Amor lets the creator *browse* the reference
library herself and heart what she likes — then writes those hearts to
`localStorage` and throws them away. For us a heart is not a bookmark, it is a
**labelled positive from the person the recommendation is for.** That is exactly
the signal `match.ts` has no source of today: FIT is computed from tag overlap
and engagement, with nothing from the model herself. A
`/p/<token>/library` route filtered to her persona, with saves written
server-side, turns her browsing into training data for the suggestion rail.

Sizing: smaller than it sounds. `plans.ts` is already the isolation boundary,
the token is already her identity, persona tags and `match.ts` already exist.
Roughly one session plus a saves table.

**Also worth taking, both trivial:** sort the niche/filter nav by item count
descending (zero curation overhead), and the *tone* — "invitation only" reads
better to talent than "your assignments".

> **Sequencing warning.** This does **not** advance Geno's stated goal. He asked
> to stop doing manual work; a self-serve library adds a surface for *her* and
> removes nothing from *him*. It is genuinely good and it is not Track A or
> Track B. If the weekend deadline is real, this waits until ingest is solved.
