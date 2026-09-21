# The Creative Director build — spec

Source: `creative-director-workflow.md` (Marketing Mastery HQ, 16 Notion pages),
read 2026-09-20. This file is the decision record and the build order. Read it
with `GAME-PLAN.md` (strategy) and `NEXT-SESSION.md` (state).

---

## The finding that drives everything

The manual's engine is **70% of her week is reskins of her own winners**. This
system has no idea what her winners are. `batch.ts` builds her week from *other
creators'* reels ranked by tag overlap (`match.ts:52`), so in the manual's own
vocabulary **every card we have ever sent is a New Test — the 10% bucket.** We
have been running the 10% and calling it the plan.

That is also why the plan reads as confusing: 21 unrelated strangers' concepts
a week, with nothing linking them to what already worked for her.

Second finding, measured 2026-09-20 across 24 active models: `formats` filled on
2, `hooks` on 1, `wont_do` on 2, intake on 1, every tier and weekly target at
its default. And because `match.ts` requires at least one format or persona tag
to explain a pick (`EXPLAINABLE`, match.ts:71), **an empty profile produces no
plan at all** — which is exactly the 9 models sitting at zero plans.

The conclusion is not "fill the profiles in". It is that a profile a human has
to type is a profile that stays empty. Everything below is derived from what the
account already did, and offered for a tap.

---

## Decisions taken (Geno: "your call", 2026-09-21)

The manual contradicts itself in five places. These are settled here so nobody
has to guess at 2am.

1. **A winner is >10× her own rolling 30-day median plays**, shares per 1k plays
   breaking ties. The manual gives three definitions; two of them need saves and
   watch-through, which Instagram does not expose outside her own Insights.
   Measuring what we cannot see would be inventing it.
2. **The 5–10× band is an Iteration** — the conservative reading, and the
   manual's own suggestion for a gap it never closes.
3. **One vocabulary: Reskins / Iterations / New Tests.** The manual uses three
   sets of words for the same three buckets.
4. **Edit Reskins and Trial Reels do not go in her weekly plan.** Edit reskins
   are editor work on an existing clip; trial reels run to 105/week. Either
   would bury the 21 cards that need filming. They get their own queues.
5. **Captions are model-written against the five formulas**, with the
   quality-control pass, drawn from her own transcripts — not the 24 canned
   strings `brief.ts` ships today.

Carried from the source and **not** fixable in code: watch-through rate and
saves are Insights-only. Views, likes, comments and shares are the whole set
readable from outside.

---

## What already maps

| Manual | Here |
|---|---|
| Step 3 — competitor research | the sweep: 196 creators, 745 library items, automatic picks |
| Step 3b — viral video breakdown | `lib/why.ts` — sound / format / shares / heat run / new concept |
| Step 8 — weekly review | `lib/digest.ts` + the Week tab |
| 70/20/10 measurement | `lib/mix.ts` (measures, does not pick) |
| Step 1 — creator level | derivable from `creator_snapshots` + `creator_posts` |
| Step 2 — niche/vibe | `lib/profiler.ts` — vision model, fixed vocabulary, proposes |
| Posting cadence targets | `lib/analytics.ts` TARGET |

## What is missing

1. **The Winners Bank** — her own posts graded against her own median. The
   source of the 70%. Data pipe exists as of 2026-09-20 (all 38 of her accounts
   are swept); only 8 accounts hold rows so far, because those 8 happened to be
   on the watchlist.
2. **The Double Down ladder** — one winner → 2 identical re-records + 3
   single-variable changes, one variable per batch, so the cause is isolable.
3. **Briefs that say how to film it** — today 25 canned lookups (`brief.ts`),
   byte-identical between two models on the same format, `location` null on 16
   of 25 formats, and `script.ts`'s shot scaffold never reaches her portal.
4. **Captions** — 24 canned strings against the manual's five formulas.
5. **A readable week** — a flat list of 21 against day-by-day 10:00/13:00/18:00.

---

## Build order

### Tonight — deterministic, no model calls

1. **`lib/bank.ts`** — per model, across every Instagram she runs: her 30-day
   median plays, and her reels graded `winner` (≥10×) / `iteration` (3–10×) /
   `rest`, shares per 1k carried for the tiebreak.
2. **Winners ingest** — her winning reels enter the library the way a scout pick
   does (`scout.enqueue` shape, URL rebuilt from the shortcode). The Mac then
   downloads, transcribes, OCRs and tags them, which is what turns "a winner"
   into a reskin brief with her own hook line in it. ~120 reels across the
   roster; the Whisper free tier covers ~428/day.
3. **Schema** — `plan_items` gains `bucket`, `vary`, `source_post`, `slot_day`,
   `slot_time`; additive, nothing rewritten.
4. **The 15/4/2 planner** — reskins and iterations from her bank, new tests from
   the existing library engine, now correctly sized at 10%. Falls back to the
   library when a model has no bank yet, and says so rather than silently
   filling the week with tests again.
5. **The schedule** — every card gets a day and a slot: 10:00 / 13:00 / 18:00,
   never two inside an hour, carousels in the gaps.

### Tomorrow — model-assisted, every output a proposal

6. Brand sentence + branded verticals (A/B/C tiers) from her own winners.
7. T6 briefs: concept, hook framing, what to film, outfit, location, length,
   caption template, what to avoid, why it fits her — competitor never named.
8. The caption engine: five formulas, the "what comment does this bait" test,
   the quality-control pass.
9. Weekly review → `model_notes` for the Sunday call, and the per-model
   Blueprint page.

### Later

10. Quality/compliance scan of raw footage (8 dimensions, PASS/WARN/FAIL).
11. Proposed binding of her posted reels to the cards that produced them.
12. The reminder cadence (planning day, shooting day, wins).

---

## Rules this build keeps

- **Nothing is typed that can be measured.** Every profile field above is
  derived and offered; a human taps.
- **Measure and pick stay separate steps.** `mix.ts` measured without picking
  for a reason; the planner is the first thing allowed to pick, and it picks
  from measurements it did not invent.
- **One variable per reskin.** The ladder is worthless if two things change at
  once — that is the whole reason the manual insists on it.
- **The model never sees a competitor's handle.**
