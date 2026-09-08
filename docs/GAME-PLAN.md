# The automated content engine — full game plan

Written 2026-09-08. Geno's goal: a closed loop that finds what is working,
turns it into scripts tailored to each model, delivers it to her phone, measures
whether it worked, and feeds that back — at 100 models, at little to no cost,
replacing what a $15-20k/mo content director does.

Read `docs/REBUILD.md` for how the system works, `docs/NEXT-INGEST.md` for the
ingest spec this supersedes at the strategy level (its Track A/B tasks stand).

---

## Part I — The loop, and how much of it already exists

Eight stages. **Four are built and shipped.** That is the headline.

| # | Stage | State |
|---|---|---|
| 1 | **Ingest** — find new top performers from watched creators | ❌ blocked, see Part II |
| 2 | **Understand** — transcribe, OCR, tag | ✅ **built** — whisper + Apple Vision + rule-based autotag, all free, on-device |
| 3 | **Score** — what is actually winning | ⚠️ **built but half-blind** — `hot.ts` works, has no views |
| 4 | **Match** — which winner suits which model | ✅ **built** — `match.ts` FIT, `BatchWeek` builds a week for everyone |
| 5 | **Generate** — turn a winner into *her* script | ❌ new, Part III |
| 6 | **Deliver** — weekly plan to her phone | ✅ **built** — tokenized portal, briefs, R2 video, two-way replies |
| 7 | **Measure** — did it actually work on her account | ❌ new, Part II — and easier than expected |
| 8 | **Feed back** — what worked for her reweights future matches | ❌ new, Part IV |

Roughly 60% of the machine exists and is running in production today. The
missing pieces are the two ends — getting content in, and learning from what
went out.

---

## Part II — The unlock: our own models' accounts

**This is the most important thing in this document.**

I previously said saves, watch time, retention and views are impossible to get.
That is true **for other people's content**. It is *not* true for accounts we
own or manage — and Geno's line *"being able to see what they're posting too and
follow as well"* points straight at the fix.

For an Instagram professional account that has authorised our app, the Insights
API returns exactly the metrics that matter: **views/plays, reach, saves,
shares, watch time, average watch time, and follows-from-post.** Everything I
called impossible is available for our own roster.

That single change does three things at once:

1. **Closes the loop.** We can finally answer "did the replication work?" — not
   by likes, but by saves and watch time, which is what the algorithm actually
   rewards. Geno's instinct about bookmarks is correct and becomes measurable
   here.
2. **Satisfies the `business_discovery` caller requirement.** That endpoint is
   called *as* a professional account we hold a token for. We have 18 models and
   a business — the prerequisite I framed as a hurdle is already met. What
   remains is the Meta app plus **App Review**, and the age-gating of the
   *targets*, which is still the open risk.
3. **Gives real benchmarks instead of borrowed ones.** Geno asked what a good
   engagement rate is. Do not import a number from a blog — every published
   benchmark is niche- and follower-dependent and mostly wrong for this vertical.
   Measure our own roster's distribution and set the threshold off it, exactly
   how `hot.ts` already uses each creator's own median rather than a global one.

**Action:** onboarding a model now includes connecting her IG professional
account. Add it to the intake form. This is the highest-leverage single change
in the entire plan and it costs nothing.

> **Caveat, stated honestly.** Insights covers *our* accounts. Competitor
> discovery still needs `business_discovery` (App Review, may exclude age-gated
> targets) or a paid provider. Onboarding our own accounts does not by itself
> unblock ingest — it unblocks *measurement*, and supplies the caller identity
> ingest needs.

---

## Part III — Script generation: the honest design decision

Geno wants winning videos turned into new scripts and variations, tailored per
model. This is the one place where the project's constitution has to bend, and
it should bend deliberately rather than by accident.

**Rule 3 of the constitution is "deterministic and rule-based over model-based,
for anything the user sees as a judgment."** `brief.ts` obeys it — lookup tables,
and `null` rather than invention. Script *writing* is generative by nature.
There is no lookup table that writes a fresh hook.

Two options, and they are not close:

| | Rule-based templates | Small-model generation |
|---|---|---|
| Cost | free | ~$0.001–0.01 per script |
| Quality | reads like mad-libs; every model gets the same sentence with nouns swapped | genuinely varied, follows her persona and rules |
| Fits constitution | yes | no — but see below |

At 100 models × 5 scripts/week that is roughly **$2–20/month**. Against a
$15-20k content director, that is inside "little to no cost."

**Recommendation: use a small model, and keep the constitution's *spirit* —**
the model drafts, the operator reviews, and it returns nothing rather than
inventing when the input is thin. Same discipline as `brief.ts`, different
mechanism. Feed it: the winner's transcript, its on-screen text beats, its hook
and format tags, and her profile (persona, `wont_do`, standing rules). Never
feed it her caption to reuse verbatim — that trap is already documented.

**Two modes, both wanted:**
- *Variation* — same structure, her details. Lower risk, higher hit rate.
- *New representation* — same underlying mechanism, different premise. This is
  where the wins come from, and where review matters most.

---

## Part IV — The feedback loop that makes it compound

This is what separates the system from a fancy swipe file, and nothing else
we have does it.

Three signals, in increasing value:

1. **Her verdict** — "I'll do this" / "Can't do this". Already collected today
   and currently unused by the matcher.
2. **Her hearts** — if the creator-facing library from the Amor teardown gets
   built, every save is a labelled positive from the person the recommendation
   is for.
3. **Her results** — via Insights, once her account is connected: did the video
   she filmed from card #7 actually beat her median on saves and watch time?

Feed all three back into `match.ts` as a per-model weight. **After a few weeks
the system stops recommending what merely looks similar and starts recommending
what has actually worked for her specifically.** That is the compounding
property, and it is the honest answer to "keep them going viral."

Guardrail: never let the loop collapse to one format. Reserve a slice of every
week for exploration outside her proven pattern, or the system optimises into a
rut and her page goes stale.

---

## Part V — What this replaces, and what it does not

Straight about the $15-20k comparison.

**It replaces:** sourcing references, tracking who is performing, matching
content to talent, drafting briefs and scripts, building and delivering weekly
plans, chasing what got filmed, and reporting on what worked. That is the bulk
of the job and most of the hours.

**It does not replace:** taste — knowing a trend is dead before the numbers say
so; relationship work with the models; negotiating and casting; and the
judgement call on anything brand-risky. Geno's weekly review is not a formality,
it is where that judgement enters the system. The plan deliberately keeps it.

---

## Part VI — Sequencing

Ordered by value per hour, and by what unblocks what.

**Now — unblocked, no dependency. All three shipped 2026-09-08.**
1. ~~**Multiplier legend in the UI.**~~ ✅ ×1.4 = 40% above that creator's own
   median (`score = likes + 10 × comments`).
2. ~~**Scheduled auto-drafting**~~ ✅ `bin/autodraft` + a Sunday-17:00 launchd
   job, `com.geno.social-transcriber.autodraft`. Drafts only; a week is
   invisible until a human sends it. First run opened 12 weeks, 204 cards.
   → **Watch R2.** Every drafted card queues its video whether or not the week
   is ever sent: ~8.3 MB × ~200 cards a week × 21-day retention ≈ 5 GB against
   a free 10 GB. Fine at eighteen models, not at a hundred. The fix when it
   bites is one line — scope `pendingUploads` to `p.status = 'sent'`.
3. ~~**Intake form → profile tags**~~ ✅ `docs/INTAKE.md`. Rule-based, proposes
   rather than saves, maps to nothing when unsure. `models.ig_account_type`
   carries the *connect her IG account* question and is answerable today,
   months before item 4.

**Next — needs the Meta app**
4. Meta app + App Review. Long pole, days to weeks, cannot be compressed.
5. Insights ingest for our own roster → views, saves, watch time, benchmarks.
6. `business_discovery` poller for competitor discovery — *if* the age-gate
   test passes. Otherwise this becomes the paid-provider decision.

**Then — the compounding half**
7. Script generation, both modes.
8. Feedback weighting in `match.ts`.
9. Creator-facing library with server-side hearts.

**Timeline, honestly.** Items 1-3 are this week. Item 4 is out of our hands.
Nothing that depends on Meta can be promised for a specific weekend, and any
plan that says otherwise is guessing.

---

## Part VII — Cost

**Free and staying free:** the Mac worker, transcription, OCR, tagging,
matching, Neon, Vercel, R2 within tier, and Insights for our own accounts.

**Small and real:** script generation, ~$2–20/month at 100 models.

**The open question:** competitor discovery. Free if `business_discovery` clears
App Review and the targets are not age-gated; otherwise a paid provider, and
that number should be gathered before committing.

**The cost that actually dominates today:** building it. Recent sessions ran
$114, $160, $211, and 2026-09-08 reached ~$48 on research and planning alone.
Per [[cost-guard-preference]], hand each phase to a fresh session with this
document rather than pushing one session through a guard.
