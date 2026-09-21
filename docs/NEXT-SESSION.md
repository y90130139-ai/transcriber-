# Handoff — 2026-09-21, the Creative Director build

Read this, then `docs/CREATIVE-DIRECTOR.md` (decisions + build order) and
`docs/CREATIVE-DIRECTOR-AUDIT.md` (all 21 sections of Geno's manual vs code).
Previous handoff: `docs/HANDOFF-2026-09-20-apify.md`. Everything below is
committed on `main` and deployed to transcriber-ten-zeta.vercel.app.

## The one idea
The manual (`~/Downloads/creative-director-workflow.md`) says 70% of her week
is reskins of **her own** winners. The old planner built every week from other
creators' reels — every card was a "new test". Tonight built the other 90%.

## Decisions (Geno, final)
- Winner = **>10x her own rolling 30-day median plays**; shares break ties.
  3-10x = iteration. Saves/watch-through/subs are NOT readable — never imply them.
- **No Insights screenshots.** Geno lines up subs against winner dates by hand.
- **Nothing typed.** Profile fields are derived and offered for a tap; anything
  that reaches a model waits for Geno's tap.
- Edit reskins + trial reels are editor work, never in her filming plan.

## Built (lib → where it shows)
- `bank.ts` Winners Bank per account · `ladder.ts` 2 controls + 3 single-variable
  (outfit→location→hook) · `split.ts` 15/4/2 planner + testing round (6→15, new
  creators with no winners) · `schedule.ts` 10:00/13:00/18:00 · `draft.ts`
  writes weeks, idempotent, `draftRoster` time-boxed (40s) — **both Sunday
  jobs now use it**; `bin/autodraft` loops until `remaining` is 0.
- `card.ts` + PlanItemCard: keep/change/your face, shot scaffold, checklist,
  stories, carousels. `insights.ts` → **Brand** tab (level, verticals A/B/C,
  3 similar creators, won't-do). `review.ts` + `attribution.ts` → **Review** tab
  (grades, Sunday call, which axis won, quality scan). `editor.ts` → **Editor**
  tab. `blueprint.ts` → **Blueprint** tab. `writer.ts` (Llama 3.3 70B, praise
  filter) → "Write captions & DMs" in the plan editor. `quality.ts` T2 scan.
- `postid.ts`: dates from shortcodes — fixed 2,315 undated rows (886 sightings
  the picker could not see). `/api/scout/health` → Today tab dead-session alert.
- `bin/scout-cookies --header` pastes a whole Cookie line; `bin/scout --session`.

## State at handoff
- Session renewed and alive. Roster pass done: 33 of 38 model accounts have
  their own posts. All 24 models get a week (9 had none). Roster split today:
  31% reskins / 10% iterations / 58% tests.
- **62 of the models' winning reels were queued for the Mac** (fetch,
  transcribe, tag). Until done, some reskin cards skip and verticals fall back
  to starters. Check: `select count(*) from transcriber.jobs where batch_id like 'hers-%' and status <> 'done'`.
- **Nothing sent to any model.** No real week has been drafted by the new
  planner yet — only throwaway 2026-12-28 weeks, all deleted.

## Next, in order
1. Confirm the 62 ingests finished; re-run `POST /api/models/[id]/week {action:"ingest"}` if any failed.
2. Draft next week for the roster (Models → a model → or `bin/autodraft`), then
   read 2-3 models' weeks in the preview with Geno before anything is sent.
3. Press "Write captions & DMs" on one plan and review quality with Geno.
4. Walk Geno through the Brand tab; accept verticals/creators per model.
5. Still open: 5 model accounts with no posts; Alexis Heart + Lae have no handle;
   captions/DMs cost Workers AI allowance (shared with Whisper) — on demand only.

## Traps
- Local `.env.local` cannot hold CLOUDFLARE_AI_TOKEN (Vercel marks it
  sensitive) — test AI routes against production (same DB).
- `pgrep -f "src.scout"` matches its own waiting shell; use `pgrep -f "[s]rc[.]scout"`.
- Phone is iOS 26: the legacy Web Inspector port test is meaningless.
- Never run two browser passes on the burner at once.
- `similar` is a Postgres reserved word (column is `similar_creators`).
