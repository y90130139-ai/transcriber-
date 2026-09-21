# Creative Director Workflow — line-by-line audit

Every section of `creative-director-workflow.md` (1,558 lines, 21 sections),
checked against the code as it stands 2026-09-21. Status is one of:

- **BUILT** — works today
- **PARTIAL** — exists but misses something the manual is explicit about
- **MISSING** — nothing in the system does this
- **N/A** — a human job the software should not take

The decisions already taken live in `CREATIVE-DIRECTOR.md`. This file is the
inventory those decisions sit on top of.

---

## 1. Scorecard

| # | Manual | Status | Where |
|---|---|---|---|
| 0 | Onboarding testing round (6 → Loom → 15) | MISSING | — |
| 1 | Creator level assessment | MISSING | derivable from snapshots + standing |
| 2 | Find the niche / brand sentence | PARTIAL | `profiler.ts` proposes persona tags only |
| 3 | Competitor research | BUILT | the sweep, 196 creators, 745 items |
| 3a | Her 3 similar creators | MISSING | — |
| 3b | Viral video breakdown | PARTIAL | `why.ts` — 5 of the manual's 11 factors |
| 4 | Starter pack data review | MISSING | signals exist, nothing reads them |
| 5 | Adapt ideas (caption/hook to her) | MISSING | 24 canned caption strings |
| 6 | Branded verticals, A/B/C tiers | MISSING | `models.formats` is generic and empty |
| 7 | What a brief must contain (7 parts) | PARTIAL | 3 of 7 |
| 7b | Weekly creative session | MISSING | — |
| 8 | Review & improve, weekly | PARTIAL | `digest.ts` is library-wide, not per model |
| 9 | 3 core starting verticals | MISSING | — |
| 10 | 6-week roadmap / cycle | MISSING | no concept of week-in-cycle |
| 11 | Creator Reskin ladder (2+3) | BUILT | `ladder.ts` (2026-09-21) |
| 12 | Edit Reskin queue (every 3 days) | MISSING | — |
| 13 | Trial reels + 5→10→15 ladder | MISSING | — |
| 14 | Batch attribution (which axis won) | MISSING | the ladder's whole payoff |
| 15 | 70/20/10 picking | BUILT | `split.ts` |
| 16 | Hook → Body → Reward structure | PARTIAL | `script.ts` exists, never reaches her |
| 17 | Background prefer/avoid list | MISSING | `location` null on 16 of 25 formats |
| 18 | Per-reel checklist (7 checks) | MISSING | — |
| 19 | Engagement psychology (6 levers) | MISSING | — |
| 20 | Caption engineering (5 formulas) | MISSING | — |
| 21 | Story strategy | PARTIAL | we *measure* stories, never direct them |
| 22 | Monthly blueprint page | MISSING | — |
| 23 | Saturday research / Sunday draft | BUILT | cron + autodraft |
| 24 | Volume math (21 and 42) | BUILT | `countsFor` |
| 25 | T1 analytics intake (screenshots) | MISSING | **the biggest data unlock** |
| 26 | T2 compliance + quality scan | MISSING | — |
| 27 | T3 weekly review per model | MISSING | the manual's spine |
| 28 | T4 winner brief | PARTIAL | `why.ts` + ladder, no hook variants/owner |
| 29 | T6 send-to-model brief | MISSING | the output format she actually reads |
| 30 | Reminders & comms cadence | MISSING | portal messages exist |
| 31 | Productivity hack / shoot day | MISSING | — |
| 32 | Posting schedule | BUILT | `schedule.ts` (2026-09-21) |

**Built: 8. Partial: 7. Missing: 17.**

---

## 2. Section by section

### §0 Onboarding testing round

Six reels, she films, Loom feedback, then fifteen more. Twenty-one testing
reels *before* Week 1. Its output is the input to everything branded.

Nothing in the system knows a new model from an established one. Every model
gets the same 21-card week, which is why a new signing gets branded cards
before anyone knows what she is good at, and why her first week is the same
shape as her tenth.

**Build:** a plan type. Week 0 = 6 cards drawn from the three core verticals,
a feedback gate, then 15. The gate matters more than the count: the manual
puts the Loom between them for a reason.

### §Initial setup — the 8 steps, 3–4 hours per creator

The system should own 1, 3, 4 and 8 outright, and draft 2, 5, 6, 7 for a tap.
That is the difference between 3–4 hours per signing and about twenty minutes.

### §1 Creator level assessment

New/small → test first. Big/experienced → personalise immediately.

Every input is already in the database: followers and their movement
(`creator_snapshots`), median plays and posting consistency (`creator_posts`),
niche clarity (tag spread across her posts), and coachability — which is what
`standing.ts` already measures from her portal behaviour.

**Build:** a derived level per model, recomputed weekly, that routes her down
one path or the other. No typing.

### §2 Find the niche → the brand sentence

> "She is the [type of girl] with [personality/vibe] who attracts [audience]."

Plus a market positioning from a fixed list of nine, and — the field nobody
ever fills — *what would feel fake if she tried it*.

We have `profiler.ts`, which already asks a vision model to choose persona tags
from our own vocabulary and files the answer with its evidence for a tap. It is
the exact machinery this needs; it just stops at tags.

**Build:** extend the profiler to draft the brand sentence and the positioning
from her own winners' frames and captions. `wont_do` gets seeded from her
decline codes — `not-comfortable` is her telling us what feels fake, and it is
already a button on her phone.

### §3 Competitor research

**BUILT**, and this is the part of the manual the system already does better
than a person: 1.5 hours a creator becomes a Saturday sweep of 196 accounts.

Two gaps:

1. **Her three creators.** The manual says narrow to 3 who look like her, match
   her energy, target her audience, and post consistently. We watch 196 for
   everyone and nobody is mapped to anyone. The Blueprint page literally opens
   with "Similar Creators To You: 1, 2, 3".
   **Build:** rank the watchlist per model by persona overlap × format overlap ×
   their own outperformance, propose 3, let a tap confirm.
2. **What to collect per video.** Seven fields; we hold link, caption, hook and
   format. Missing: outfit/location notes, why it fits *her*, and the
   copy/reskin/adapt decision.

### §3b Viral video breakdown

Eleven possible reasons a reel worked. `why.ts` (built 2026-09-21) covers five:
sound, format history, shares, the creator's streak, and "new concept".

Missing, in order of how cheaply we can get them:

| Factor | Cost to add |
|---|---|
| Text on screen | **free — `on_screen_text` is already stored** |
| Caption | free — stored |
| Hook | free — `openingOf` already extracts it |
| Outfit / location / expression / body angle | vision model, already wired for personas |
| Personality / niche relevance | vision + her profile |

And the manual's actual instruction, which we do not do at all: **say which
parts to copy exactly and which to change.** "❌ Just sending the caption. ✅
Keep the same confident facial expression, similar outfit vibe, same POV
structure."

### §4 Starter pack data review

What felt natural, what felt forced, what she is good at, best outfits,
best locations, early winners.

Every signal exists and nothing reads it: `decline_code` (five buckets,
including `not-comfortable` and `wrong-outfit`), `filmed_at` versus sent,
her own per-format performance once her winners are tagged, and her verdicts.

**Build:** a derived "what she is good at" panel — her formats ranked by her
own median multiple, her decline patterns, and the gap between what we send
and what she films.

### §5 Adapt ideas

Keep the proven structure, change the caption, hook, wording, expression,
outfit, location, delivery. The example in the manual is a caption rewrite.

We send the *reference's* hook, quoted, and a canned caption. Nothing is
adapted to her. This is the caption engine (§20) plus her profile block.

### §6 Branded content direction

3–5 branded verticals, each with example captions/hooks, outfit and location
notes. Generic pillar → branded name: "talking videos" → "stoner girl high
thoughts".

`models.formats` holds generic tags and is empty on 22 of 24. There is no
vertical entity at all — no name, no examples, no volume target, no A/B/C tier.

**Build:** `verticals` per model, derived from her own winners' format+hook
clusters, named by the model (proposal, one tap), each carrying example hooks,
outfit/location notes, a volume target and a tier. This is also what fixes the
empty-profile hole: `match.ts` requires a tag to explain a pick, so a model
with no tags currently gets **no plan at all** — 9 of 24 sit at zero plans.

### §7 Execution & feedback — what every card must contain

| Required | Status |
|---|---|
| inspiration video | BUILT |
| adapted caption / hook | PARTIAL — hook quoted, caption canned |
| what she needs to recreate | PARTIAL — only on reskin cards, since tonight |
| outfit notes | PARTIAL — 25 canned strings, identical between models |
| location / background notes | **MISSING on 16 of 25 formats** |
| facial expression direction | **MISSING entirely** |
| acting / talking notes | PARTIAL — one drafted line |

Also missing: `editing_notes` is never drafted, `plans.title` and `plans.intro`
are never drafted, and `script.ts` — the beat-by-beat shot scaffold, the richest
guidance we generate — **is console-only and never reaches her portal.**

### §7b Weekly creative session

Review what she posted, adjust hooks/execution/expressions/pacing/captions/
framing, decide what to double down on and what to stop.

**Build:** the Sunday call sheet. This is T3's `model_notes` and it is pure
derivation from her week.

### §8 Review & improve

Views, comments, saves, shares, profile visits, subs. Best hooks, captions,
formats, verticals.

`digest.ts` (built 2026-09-21) does this across the library. Per model it does
not exist. **Saves, profile visits and subs are not readable from outside** —
see §25, which is the manual's own answer to that problem and the thing I
wrote off too quickly last time.

### §9–10 The weekly engine: 3 core verticals, 6-week roadmap

Every creator starts on **Talking (Car Confessions) · Thirst Traps · Captions**.
Weeks 1–2 volume, 3–4 prune and concentrate, 5–6 lock the pattern. Repeat.

Nothing in the system knows what week of the cycle a model is in, so nothing
ever prunes and nothing ever locks. This is also the cheapest fix for a new
signing: three known-good verticals beat an empty profile.

### §11–14 Double Down

| Piece | Status |
|---|---|
| Creator Reskin, 2 controls + 3 single-variable | **BUILT tonight** |
| Axis rotation outfit → background → hook | **BUILT tonight** |
| Edit Reskin — same clip re-cut, every 3 days | MISSING |
| The 8 specific edit moves | MISSING |
| Trial reels, 5 edited versions of a winner | MISSING |
| Volume ladder 5 → 10 → 15 a day | MISSING |
| **Batch attribution — which axis actually won** | **MISSING** |

The last row is the point of the whole system and we do not do it. We now
produce controlled batches and never read the result back. Two controls and
three outfit variants is an experiment; without the readout it is just five
posts.

**Build:** after a batch's posts have settled, compare variants against their
own controls and write the answer to her profile — "outfit changes move her
numbers, backgrounds do not". That is what the manual calls finding her brand.

### §16–19 The Viral Reels Blueprint

- **Hook → Body → Reward.** `script.ts` builds this and she never sees it.
- **Backgrounds: prefer outside / pool / beach / garden / city; avoid white
  walls, bedrooms, messy rooms.** This alone fills the 16 blank `location`
  fields with something true and useful.
- **Shorter videos, good light, clean setup** — partially in the length line.
- **The recreate instruction**, verbatim: *"Copy this structure, but change the
  outfit, background, angle, and small details."*
- **The per-reel checklist** — 7 checks, including "does this have 10M-view
  potential" and "will someone actually type a comment".
- **Psychology:** engagement bait, humour, relatable, scenario, ragebait, and
  the rule that sexuality stays a background layer — entertainment and
  retention are the job. None of this reaches either of us at the moment of
  choosing a card.
- **Strong categories:** mirror selfies with flirty captions, acting,
  transitions, talking, POV. **Extra to research:** mirror, reveal, day in the
  life, confession talking, storytelling, flirty humour.
  Our format taxonomy has 25 tags and is missing **mirror**, **reveal**,
  **confession** and **car-confession** as distinct formats — which means the
  three core verticals cannot even be expressed in our own vocabulary.
- **Story strategy:** CTAs, polls, questions, teasers, lifestyle, as a
  conversion circle toward OF. We measure whether a story went up and never say
  what should be in it.

### §20 Caption engineering

Five formulas with named mechanisms, build rules, variations, a bans list, the
generation prompt, and a second quality-control pass. It is the most
operationally complete section in the document and we implement none of it.

Today: 24 canned strings, `collab` deliberately null.

The one-question test is the part worth keeping even if we build nothing else:
**"what exact comment is this designed to produce?"**

### §22 The monthly blueprint

A per-model page: similar creators, brand pillars, and per pillar an idea list,
reference reels, a volume target and notes. Plus what's working, what to double
down on, what to cut, the exact volume split, and clear execution steps.

This is the natural home for most of what is missing above, and it is a
*document we can generate* rather than a feature. Ownership transfer is in
there too: after a few cycles she generates ideas inside our framework.

### §23 Cadences

Saturday research and planning — **BUILT**. Sunday review call and final
alignment — the draft is built, the call sheet is not. Monthly blueprint
refresh and the 6-week upgrade (+1 vertical, batch shooting, second shoot day,
~42 reels/week) — missing, though `countsFor(42)` already computes the split.

### §25 T1 — Analytics intake  ← the biggest single unlock

She screenshots her Insights, the screenshots are OCR'd, the metrics land on
the post's row: **views, likes, comments, saves, shares, reach, profile visits,
follows, watch time.**

I said last night that saves and watch-through were unavailable and could not
be faked. That is true of the *public* API — and this template is the manual's
answer to exactly that, which I skipped past. We already have every piece:

- `vendor/bin/ocr-text` — Apple Vision OCR, **on-device, free, no API key**,
  already built by `setup.sh` and already used on every wordless reel.
- Browser-direct Blob uploads, already used for intake forms and photos.
- A model portal she already opens every week.

**Build:** an upload control on her plan page ("drop this week's Insights"),
the Mac OCRs them, the numbers land per post. That turns the winner definition
from "views only" into the manual's real grading matrix — views × watch-through
— and gives saves and profile visits, which are the two metrics that actually
predict subs.

**This is the one thing that needs her to do something.** Everything else here
is derived.

### §26 T2 — Compliance + quality scan

Pre-post review: PASS/WARN/FAIL plus 8 quality dimensions (hook, lighting,
angle, length, pacing, caption, audio, style match), composite under 7.0
triggers a revision brief. Same vision model as the profiler.

### §27 T3 — Weekly review  ← the spine

Grades every post (Flop → Viral), assigns an action (Reskin / Iterate / Stop /
Test Again), flags winners for the pipeline, **checks 70/20/10 drift**, drafts
next week, and writes the Sunday call notes.

We have the pieces scattered — `mix.ts` measures drift, `split.ts` drafts,
`why.ts` explains — and no object that is "her week, reviewed".

### §28–29 T4 winner brief, T6 send-to-model brief

T4: why it won, what to maintain, what to swap, length target, caption
template, **3 hook variants**, owner (editor) and due (+3 days).
T6: the same thing pointed at her, in her voice, **with the competitor
stripped out**, in two versions — a short DM and a full filming brief.

T6 is the format she actually reads. It is the single highest-value thing to
build for "the content plan is confusing", and it is a writing task on top of
data we will already have.

### §30 Communication & reminders

Planning day and shooting day reminders, **reworded each week rather than
copy-pasted**, the week-1 honesty prompt ("tell me which of these didn't feel
like you"), wins updates, fast feedback after she sends content, and a call
cadence that differs by month and creator type.

### §31 The productivity hack

Four outfits × 6 reels = 24 in a shoot day, with photo sets captured between
outfit changes. This is a shoot-day sheet we can generate from her week: which
outfits, which cards per outfit, what to shoot between changes.

### §32 Posting schedule — **BUILT tonight**

10:00 / 13:00 / 18:00, carousels in the gaps, never two inside an hour.

**Except carousels themselves.** The manual wants 1–3 a week; our planner
allocates reels only, and `analytics.ts` already measures her against a
2-a-week carousel target she is never actually asked for.

---

## 3. What is needed from Geno

1. **Web Inspector on the phone**, then the cookie renewal. The burner session
   died tonight; the roster pass is what fills every model's own post history,
   and the Winners Bank is empty without it. Nothing else here matters until
   this is done.
2. **A decision on Insights screenshots** (§25). If she sends them weekly, the
   grading matrix becomes real: saves, watch-through, profile visits, follows.
   If not, we stay on views and shares and say so.
3. **Nothing typed.** Brand sentences, verticals, levels, similar creators and
   off-limits lists are all derived and offered for a tap.

## 4. Build order from here

**First — unblocks everything:** session renewal → roster pass → banks fill.

**Then, in value order:**

1. T6 briefs — what she reads (§29)
2. Caption engine — five formulas (§20)
3. T3 weekly review per model + Sunday call sheet (§27, §7b)
4. Branded verticals + her 3 similar creators (§6, §3a)
5. Insights intake (§25) — if she will send them
6. Batch attribution (§14) — the ladder's payoff
7. Level assessment + onboarding mode (§1, §0)
8. Edit reskin + trial reel queues (§12, §13)
9. Monthly blueprint page (§22)
10. Quality scan (§26)

## 5. Polish — cheap, high ratio

- Fill the 16 blank `location` fields from the manual's own prefer/avoid list.
- Add `mirror`, `reveal`, `confession`, `car-confession` to the format
  taxonomy — the three core verticals cannot be named without them.
- Ship `script.ts`'s Hook → Body → Reward scaffold to her portal.
- Put the per-reel checklist on the card.
- Draft `plans.title` and `plans.intro` — her week currently opens with nothing.
- Seed `wont_do` from `not-comfortable` declines.
- Give each card its copy-exactly / change-this line.
- Put carousels into the week (1–3, in the gap slots that already exist).
