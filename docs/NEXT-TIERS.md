# Creator tiers (S/A/B/C) and heat (🔥 / 🧊): design record

**BUILT 2026-09-17, same session.** Geno said to keep going rather than hand
off, so the four decisions below were taken at the recommended defaults. What
was actually built, and how it was verified, is in `docs/PORTAL-V2.md` under
"Standing: priority and heat". This file is kept as the reasoning behind it.

---

## What Geno asked for, in his words (condensed)

- Tiers **S, A, B, C**, decided by **(1) revenue she generates** and
  **(2) how proactive she is** with content.
- Prioritise the top tiers: the best plan experience, and "constantly on top of"
  their content.
- Know who is actually using the portal: opening it, tapping *I'll do this* /
  *I won't*, commenting. "Who is the most proactive when provided these content
  plans", to decide **who gets the most attention to scale and grow**.
- See who keeps getting plans while rarely being on top of them.
- A **🔥** for a creator who clears the week (e.g. all 21 reels filmed and
  handed back), and a **cold** mark for one who did a few or never looked.

## Read before building

- `docs/PORTAL-V2.md`: all phases; the carry-forward section is the latest.
- `docs/GAME-PLAN.md`: step 7 *Measure* and step 8 *Feed back* are this, from
  the other end.
- `cloud/scripts/migrate.mjs` ~line 351: **a `tier` column already exists** (see
  trap 1).
- `cloud/src/lib/sweep.ts`: the roster sweep already computes per-model flags
  and orders by `m.tier`. The heat score belongs beside it, not in a new place.
- `cloud/src/lib/batch.ts`: "Build a week for everyone" takes models **in tier
  order** so the top tier gets first refusal on a contested reel. That is
  already a prioritisation lever, and it reads `tier`.

## Traps. Do not re-learn these

1. **`models.tier` already means something else.** It is `A|B|C`, default `B`,
   and it means *how bespoke her plan is* (A bespoke, B mixed, C library-only).
   The migration comment calls it "a commercial fact about the arrangement".
   The roster groups by it ("B · MIXED") and `batch.ts` orders by it. Geno's
   S/A/B/C means *priority*, which is a different axis. Do not silently
   repurpose the column. See decision 1.
2. **There is almost nothing to score yet, and that is an operator-side fact.**
   On 2026-09-17, of 20 creators, **only 3 had ever been sent a week** (Blair
   Banks, Milky Sins, Mona Faith); every other plan is a draft she cannot see.
   Every proactivity number for the other 17 would be zero *because we never
   sent*, not because she ignored anything. **A draft week must never count
   against her.** Score sent weeks only, and show "not enough sent weeks yet"
   rather than 🧊.
3. **Revenue is not in the system at all.** No column, no import. It has to come
   from somewhere (decision 2).
4. **`plans.opened_at` is stamped once**, on the first render only
   (`markOpened` in `lib/plans.ts`, `where opened_at is null`). There is no
   visit count and no last-seen. "Is she coming back to it" is not answerable
   from today's data.
5. **`filmed_at` is her self-report; `posted_at` / `post_url` is bound by hand in
   the console** and is the only verified delivery. Weight verified over
   claimed once posting is being bound consistently.
6. **Carried weeks.** Since the carry-forward button, an unfilmed video can move
   week to week. That movement is itself a signal ("plan debt"), but only if it
   is recorded. Today the move leaves no trace of where a card came from.
7. Production has real creators. Verify reads with every non-GET aborted at the
   browser, and writes against PGlite first. The harness pattern (bundle the
   real route with only db, auth and `next/server` swapped) is described in the
   carry-forward section of `PORTAL-V2.md`.

## Signals available today (no new tracking needed)

Per **sent** week, per creator:

| Signal | Source | Meaning |
|---|---|---|
| Opened | `plans.opened_at` | She looked at all |
| Speed to open | `opened_at - sent_at` | Hours, not days = engaged |
| Answered | `plan_items.accepted_at` / `declined_at` | She decided on the card |
| Declined, and why | `declined_at`, `decline_code` | A constraint, not laziness |
| Talked | `plan_messages` where `author='model'` | Feedback, questions |
| Filmed | `plan_items.filmed_at` | Self-reported work |
| Posted | `plan_items.posted_at`, `post_url` | Verified delivery |
| Cleared | filmed = cards on the week | The 🔥 moment Geno described |

## Signals that need a small addition

- **Visits:** a `plan_visits` (or `plan_events`) row per page load, or at least
  `last_seen_at` + `visit_count` on `plans`. Needed for "is she still in it".
- **Carried from:** `plan_items.carried_from_week` set by the carry route, so
  backlog is countable.
- **Event log (optional, better):** one `transcriber.plan_events(model_id,
  plan_id, item_id, kind, at)` written by the existing endpoints (open, accept,
  decline, film, message). Gives a timeline and a real "last active", and makes
  every future score cheap. Recommended over bolting on columns.

## Proposed design (Claude's recommendation, not yet agreed)

### Two separate things, not one

1. **Heat is automatic and weekly.** It shows how she is responding to plans
   *right now*: 🔥 / neutral / 🧊. No human input, recomputed from the signals.
2. **Tier (S/A/B/C) is a decision Geno confirms.** The system *suggests* it from
   revenue × sustained heat; Geno accepts or overrides, with the override kept.
   A letter that silently changes every Monday stops meaning anything, and a
   creator's standing should not drop off a cliff because of one sick week.

### Engagement score (0–100), last 4 sent weeks, recent weeks weighted more

Suggested weights, to be tuned with real data:

- **Filmed** share of cards (she did the work): 35
- **Answered** share of cards (accept or decline, *either* counts; a
  reasoned decline is engagement): 20
- **Posted** share of cards (verified): 20, rising as binding gets consistent
- **Opened**, and how fast after sending: 15
- **Talked**, any message from her that week: 10

**Heat:**
- 🔥 **On fire:** she cleared a sent week (every card filmed), *or* score ≥ 75.
  The clear is also an event worth surfacing on its own: "Milky cleared 26/26".
- 🧊 **Cold:** a sent week unopened for 3+ days, *or* score < 25 across 2+
  sent weeks.
- **New:** fewer than 2 sent weeks. No judgement yet.
- Otherwise neutral.

### Tier = revenue band × engagement, read as four situations

The letter matters less than what to *do* about each creator, and the two
axes disagree often enough that one merged number hides the useful case:

| | Engagement high | Engagement low |
|---|---|---|
| **Revenue high** | **S · Star.** Protect: bespoke plans, first pick of reels (`batch.ts` order), fastest turnaround | **A · At risk.** Earning but not using the plan. *More plans won't fix it.* A conversation will |
| **Revenue low** | **A/B · Rising.** Proactive but not yet earning: **the best place to invest to scale** | **C · Dormant.** Library-only plans, minimal effort until she re-engages |

Geno's stated goal ("put more effort into them and help them scale and grow")
points at **Rising** as the growth bet and **Star** as the protect bet. The
**At risk** quadrant is the one a single score would hide: high revenue masks
low engagement.

### Where it shows up

- **Roster card:** heat emoji + tier letter beside her name; group the roster by
  priority tier (see decision 1 for the existing grouping).
- **Profile sheet:** a small engagement panel: last 4 sent weeks as a strip
  (opened / answered / filmed / posted), last active, open decline codes.
- **Sweep:** "Cleared this week" and "Cold" lists at the top, so the 🔥 and 🧊
  are a morning glance rather than something to go and look for.
- **Batch week:** order by priority tier so Stars get first refusal.
- **Never on her page**, unless Geno decides otherwise (decision 4).

### Build order

1. Event log (or visit columns) + `carried_from_week`. Additive migration.
   Starts collecting now, because heat is only as good as the history behind it.
2. `lib/engagement.ts`: pure scoring over sent weeks, unit-tested on the real
   shapes (Milky: sent + opened + 3 filmed; 17 creators with no sent week).
3. Revenue input per decision 2.
4. Suggested tier + Geno-confirmed tier, override kept with a date.
5. Roster, profile and sweep UI. Verify with writes aborted, both themes,
   320–1440.

## Decide first. Ask Geno

1. **Existing `tier` (bespoke/mixed/library) vs new S/A/B/C priority.**
   (a) keep both: new `priority` column, service level stays; (b) replace:
   priority drives service level (S/A → bespoke, B → mixed, C → library);
   (c) something else. Recommendation: **(a)**, with S/A *defaulting* to
   bespoke, so the two can still differ.
2. **Where does revenue come from?** Monthly figure typed per creator in her
   profile; a CSV/export from the agency tool (e.g. Infloww) pasted monthly; or
   bands only (high/mid/low) with no dollar figures stored. Recommendation:
   **bands typed monthly** to start. Dollar figures are sensitive data in a
   system with shared links.
3. **Thresholds.** What revenue counts as "high" for this roster; is "cleared"
   *every card filmed* or *every accepted card filmed* (a reasoned decline
   shouldn't cost her the 🔥).
4. **Does she ever see it?** Internal only, or a positive-only nudge on her page
   ("You cleared last week 🔥"). A 🧊 shown to a creator is a retention risk.
   Recommendation: **internal only**, revisit a positive badge later.

Also still pending from before (remind at the start): notifications deferred;
the Meta app submission; the ten-creator category check.
