# Rollback

This repo is not under git, so anything replaced wholesale gets a copy here
before the change lands.

- `plan.css.v1` — the creator plan stylesheet as it stood before the Phase 1
  restyle on 2026-09-05. To undo the restyle:

  ```bash
  cp docs/rollback/plan.css.v1 cloud/src/app/plan.css
  ```

  The one markup change that shipped with it is the segmented progress bar in
  `cloud/src/components/plan/PlanView.tsx` — the `.plan-bar` div. v1 expects a
  single `<span>` with an inline `width` percentage; v2 renders one `<i>` per
  item. Reverting the CSS alone leaves the ticks unstyled, so revert both.

## Phases 3–6, 2026-09-05

Every file each phase overwrote was copied here first, suffixed with the phase
it was taken before. To undo one phase, copy its `.pre-pN` files back over the
originals — later phases build on earlier ones, so undoing phase 4 means
restoring `.pre-p4` for **every** file that has one, not just the one that
looks wrong.

```bash
# Undo phase 6 (the console restyle) and nothing else:
cd ~/projects/social-transcriber
cp docs/rollback/globals.css.pre-p6   cloud/src/app/globals.css
cp docs/rollback/Workbench.tsx.pre-p6 cloud/src/components/Workbench.tsx
cp docs/rollback/Gate.tsx.pre-p6      cloud/src/components/Gate.tsx
```

Where each copy goes back to:

| Copy | Original |
|---|---|
| `brief.ts.pre-p*` | `cloud/src/lib/brief.ts` |
| `models.ts.pre-p*` | `cloud/src/lib/models.ts` |
| `plans.ts.pre-p*` | `cloud/src/lib/plans.ts` |
| `migrate.mjs.pre-p*` | `cloud/scripts/migrate.mjs` |
| `plan.css.pre-p*` | `cloud/src/app/plan.css` |
| `library.css.pre-p*` | `cloud/src/app/library.css` |
| `globals.css.pre-p6` | `cloud/src/app/globals.css` |
| `tokens.css.pre-p6` | `cloud/src/app/tokens.css` |
| `PlanView.tsx.pre-p*` | `cloud/src/components/plan/PlanView.tsx` |
| `PlanItemCard.tsx.pre-p*` | `cloud/src/components/plan/PlanItemCard.tsx` |
| `PlanEditor.tsx.pre-p*` | `cloud/src/components/roster/PlanEditor.tsx` |
| `RosterTab.tsx.pre-p5` | `cloud/src/components/roster/RosterTab.tsx` |
| `ModelSheet.tsx.pre-p5` | `cloud/src/components/roster/ModelSheet.tsx` |
| `types.ts.pre-p*` | `cloud/src/components/roster/types.ts` |
| `Workbench.tsx.pre-p*` | `cloud/src/components/Workbench.tsx` |
| `Gate.tsx.pre-p6` | `cloud/src/components/Gate.tsx` |
| `api-plans-id-route.ts.pre-p*` | `cloud/src/app/api/plans/[id]/route.ts` |
| `api-plans-id-items-route.ts.pre-p*` | `cloud/src/app/api/plans/[id]/items/route.ts` |
| `api-models-route.ts.pre-p5` | `cloud/src/app/api/models/route.ts` |

**Files with no copy here, because they are new.** Deleting them is the undo:
`cloud/src/lib/sweep.ts`, `cloud/src/app/api/sweep/route.ts`,
`cloud/src/app/api/models/[id]/posts/route.ts`,
`cloud/src/components/roster/SweepTab.tsx`,
`cloud/src/components/roster/SweepFlags.tsx`.

**Schema is not rolled back by any of this.** Every migration phases 3–6 added
is an `add column if not exists` on a nullable column, plus one backfill of
`card_no` guarded on null. Leaving the columns in place after reverting code
costs nothing and breaks nothing. Do not drop them — `card_no` in particular
cannot be regenerated to the same numbers once the rows have moved.

`cdpshot.mjs` here is the screenshotter these phases were verified with. See
the "Verifying" section of `docs/PORTAL-V2.md`.

## The timezone picker fix, 2026-09-06

`*.pre-place` copies, taken before the `models.place` change. See "the timezone
picker could not show what was picked" in `docs/PORTAL-V2.md`.

| Copy | Original |
|---|---|
| `migrate.mjs.pre-place` | `cloud/scripts/migrate.mjs` |
| `models.ts.pre-place` | `cloud/src/lib/models.ts` |
| `timezones.ts.pre-place` | `cloud/src/lib/timezones.ts` |
| `api-models-route.ts.pre-place` | `cloud/src/app/api/models/route.ts` |
| `api-models-id-route.ts.pre-place` | `cloud/src/app/api/models/[id]/route.ts` |
| `types.ts.pre-place` | `cloud/src/components/roster/types.ts` |
| `ModelSheet.tsx.pre-place` | `cloud/src/components/roster/ModelSheet.tsx` |

Reverting all seven restores the old behaviour, bug included. `models.place`
can be left in place — it is nullable, nothing but the picker reads it, and the
pre-fix code never selects it. Do not drop it if there is any chance of rolling
forward again; it is the only record of which of thirty same-zone places was
actually chosen.

`PORTAL-V2.md.pre-tidy` is the doc as it stood before the phase 1/2/2b
checkboxes were ticked to match what had already shipped. Documentation only —
no code depends on it.

## Full snapshot before the audit build, 2026-09-06

`snapshot-2026-09-06-pre-audit-build/` is a complete copy of `cloud/src`,
`cloud/scripts` and `cloud/package.json` as they stood after the timezone-place
fix and before any audit-driven work began. 87 files.

This is the one-command way back to a known-good, fully deployed state:

```bash
cd ~/projects/social-transcriber
rsync -a --delete docs/rollback/snapshot-2026-09-06-pre-audit-build/src/     cloud/src/
rsync -a --delete docs/rollback/snapshot-2026-09-06-pre-audit-build/scripts/ cloud/scripts/
cp docs/rollback/snapshot-2026-09-06-pre-audit-build/package.json cloud/package.json
cd cloud && npm install && npx vercel --prod --yes
```

`--delete` matters: it removes files the audit build added, which a plain copy
would leave behind. Schema is not reverted by this and does not need to be —
every column added is nullable and additive, and code that predates a column
simply never selects it.

The per-file `.pre-*` copies stay as they are. This snapshot is the coarse
undo; those remain the surgical one.

## The audit build, 2026-09-06

Fourteen items from the audit review, deployed the same day in three batches.
The brief is `docs/BUILD-AUDIT-FIXES.md`; what was found and decided per item is
in `docs/PORTAL-V2.md` under "The audit build, 2026-09-06".

Every file the build overwrote has a `.pre-audit` copy here. Thirty-two of them.
To undo the whole build, prefer the snapshot block above — `rsync --delete`
removes the new files too, which copying `.pre-audit` back does not.

| Copy | Original |
|---|---|
| `migrate.mjs.pre-audit` | `cloud/scripts/migrate.mjs` |
| `models.ts.pre-audit` | `cloud/src/lib/models.ts` |
| `plans.ts.pre-audit` | `cloud/src/lib/plans.ts` |
| `brief.ts.pre-audit` | `cloud/src/lib/brief.ts` |
| `match.ts.pre-audit` | `cloud/src/lib/match.ts` |
| `sweep.ts.pre-audit` | `cloud/src/lib/sweep.ts` |
| `autotag.ts.pre-audit` | `cloud/src/lib/autotag.ts` |
| `plan.css.pre-audit` | `cloud/src/app/plan.css` |
| `library.css.pre-audit` | `cloud/src/app/library.css` |
| `globals.css.pre-audit` | `cloud/src/app/globals.css` |
| `PlanView.tsx.pre-audit` | `cloud/src/components/plan/PlanView.tsx` |
| `PlanItemCard.tsx.pre-audit` | `cloud/src/components/plan/PlanItemCard.tsx` |
| `PlanEditor.tsx.pre-audit` | `cloud/src/components/roster/PlanEditor.tsx` |
| `RosterTab.tsx.pre-audit` | `cloud/src/components/roster/RosterTab.tsx` |
| `SweepTab.tsx.pre-audit` | `cloud/src/components/roster/SweepTab.tsx` |
| `ModelSheet.tsx.pre-audit` | `cloud/src/components/roster/ModelSheet.tsx` |
| `AssignBar.tsx.pre-audit` | `cloud/src/components/roster/AssignBar.tsx` |
| `types.ts.pre-audit` | `cloud/src/components/roster/types.ts` |
| `Workbench.tsx.pre-audit` | `cloud/src/components/Workbench.tsx` |
| `LibraryTab.tsx.pre-audit` | `cloud/src/components/LibraryTab.tsx` |
| `CreatorsTab.tsx.pre-audit` | `cloud/src/components/CreatorsTab.tsx` |
| `p-token-page.tsx.pre-audit` | `cloud/src/app/p/[token]/page.tsx` |
| `api-library-route.ts.pre-audit` | `cloud/src/app/api/library/route.ts` |
| `api-models-route.ts.pre-audit` | `cloud/src/app/api/models/route.ts` |
| `api-models-id-route.ts.pre-audit` | `cloud/src/app/api/models/[id]/route.ts` |
| `api-plans-route.ts.pre-audit` | `cloud/src/app/api/plans/route.ts` |
| `api-plans-id-route.ts.pre-audit` | `cloud/src/app/api/plans/[id]/route.ts` |
| `api-plans-id-items-route.ts.pre-audit` | `cloud/src/app/api/plans/[id]/items/route.ts` |
| `api-creators-route.ts.pre-audit` | `cloud/src/app/api/creators/route.ts` |
| `api-creators-handle-route.ts.pre-audit` | `cloud/src/app/api/creators/[handle]/route.ts` |
| `api-plan-token-verdict-route.ts.pre-audit` | `cloud/src/app/api/plan/[token]/verdict/route.ts` |
| `PORTAL-V2.md.pre-audit` | `docs/PORTAL-V2.md` |

**Files with no copy here, because they are new.** Deleting them is the undo:

```
cloud/src/lib/batch.ts
cloud/src/lib/decline.ts
cloud/src/components/PersonaBackfill.tsx
cloud/src/components/roster/BatchWeek.tsx
cloud/src/components/roster/BulkAssign.tsx
cloud/src/components/roster/CollisionFlag.tsx
cloud/src/components/roster/ModelWeekPicker.tsx
cloud/src/app/api/models/[id]/brief/route.ts
cloud/src/app/api/plans/batch/route.ts
```

`ModelWeekPicker.tsx` is the one new file with a dependency in an old one:
`AssignBar.tsx` imports it. Restoring `AssignBar.tsx.pre-audit` puts its own
two selects back, so the pair can be reverted together or not at all.

**Schema is not rolled back by any of this and does not need to be.** The build
added `models.drive_url`, `models.delivery_note`, `plan_items.decline_code`,
`plans.opened_at` — all nullable `add column if not exists` — and one new table,
`transcriber.model_brief_defaults`. Code that predates a column never selects
it. Do not drop them.

**One thing the schema alone will not undo.** Approving a creator in the persona
backfill writes `human` persona tags onto every one of that creator's items and
replaces whatever persona tags were there. Reverting the code leaves those tags
in place, which is correct — they are a human's decision, not the build's — but
it is the one write here that is not confined to a new column.

**Vercel Preview secrets are not code and are not reverted by any of the above.**
Eight secrets were scoped to Preview on 2026-09-06. Remove them with
`npx vercel env rm <name> preview` if preview builds should go back to failing.

---

## Phase 7 ship — 2026-09-06

Suffix `.pre-phase7-ship`. These are the files as they stood when phase 7 was
built but not yet deployed, i.e. before the comparison fix and the brief
opening. Restoring all six together returns the drafter and the tagger to that
state.

```
cloud/src/lib/lexicon.ts
cloud/src/lib/autotag.ts
cloud/src/lib/tagging.ts
cloud/src/lib/brief.ts
cloud/src/lib/models.ts
cloud/src/app/api/plans/[id]/items/route.ts        -> plan-items-route.ts.pre-phase7-ship
```

`models.ts` and the items route are a pair: the route destructures `priorBlob`
and `priorDirection` off `draftBothFor`, so reverting one without the other
fails to compile.

**Schema is not rolled back and does not need to be.** The ship ran
`migrate.mjs`, which added `transcripts.has_looked`, `transcripts.on_screen_text`
and `transcripts.on_screen_captions` — all nullable, all additive. Code that
predates them never selects them.

**Two writes are not confined to new columns.** `./bin/relook --apply` set
`has_looked` on all 172 rows and filled the two text columns, and `retag?all=1`
replaced every `auto` tag in `transcriber.tags`. Reverting the code and
re-running `retag?all=1` restores the previous auto tags; `human` tags were
never touched by either. Nothing re-fetched a video.

**If the briefs are reverted, existing cards stay safe.** `isUntouchedDraft`
gained `priorBlob` / `priorDirection` so a card drafted before the screen could
be quoted is still recognised as the drafter's own. Measured: 67 references
change their draft once the screen is readable, and without those two forms
every card drafted from one of them would have been stranded — read as Geno's
work and never redrafted. Going back drops the new forms, which is harmless in
that direction because the old wording is what the old drafter writes.

## Preview fallback + lexicon — 2026-09-06

Suffix `.pre-preview-lexicon`: `cloud/src/lib/sql.ts`, `match.ts`, `lexicon.ts`,
`autotag.ts`. The three other `preview()` call sites
(`api/plans/[id]`, `api/library`, `api/creators/[handle]`) changed by one
argument each and are listed here rather than copied.

`preview()` gained an optional `screen` column and now falls back to
`on_screen_text` when the transcript is empty. **Blank previews went 54 -> 6
across the library, and 13 -> 0 in the top 40 suggestions.**

One trap worth keeping: **bare `btrim()` strips spaces and nothing else.** A
silent transcript holds a lone newline, which survives it and tests as
non-empty, so `nullif(..., '')` never fired and the first version of this fix
changed exactly 0 rows while looking correct. `trimmed()` names the characters:
`btrim(x, E' \t\r\n')`. This was caught by running the compiled helper against
the real database instead of trusting the code to be right.

Lexicon: `vs` / `versus` joined `HOOK_WORDS.contrast`, and `isLabelledTurn()`
reads a two-beat caption where both beats carry a colon (`In a relationship:` /
`Single:`). Measured 4 hook tags moved, all to `contrast`, **0 on the spoken
branch.** Silent videos with a real hook: 24 -> 26 of 54.

## `pov-relatable` hook tag — 2026-09-06

Suffix `.pre-pov-hook`: `cloud/src/lib/taxonomy.json`, `lexicon.ts`,
`autotag.ts`, `brief.ts`. Four files, all additive — going back removes the tag
and the rows fall to whatever they held before. `match.ts` was checked and NOT
changed: it reads the hook arrays out of `transcriber.tags` and never names a
hook, so a ninth tag needs nothing there. The UI needed nothing either —
`FilterBar` and `TagPicker` both render `taxonomy[axis].tags`.

**Why.** 50 of the 87 silent items sat on the `text-claim` placeholder and 15
more were filed as `question`s they never ask. The uncovered shape is a scenario
the viewer is meant to recognise — `POV: Me when boredom strikes`, `when he's
snatching your soul but you have to be quiet`, `Me watching the slideshow Apple
made`. None of the eight existing hooks describes that, so those items were
under-described rather than mistagged.

`isScenario()` has three ways in: the `POV` label; a `when` clause with no
question mark (`me when …` counts); a POV subject followed within three words by
a gerund. `HOOK_WORDS.notGerunds` is what stops `my morning routine` being read
as somebody caught mid-action.

**`POV_SCORE = 0.92` is bracketed on both sides and both sides matter.** Above
`question`'s 0.9, or `when …` keeps losing to the question branch. Below
`COMPARISON_SCORE`'s 0.95, or the phase-7 comparison fix regresses: `Me: Are you
sure it's 18 cm?` / `How he measured it:` opens on a POV subject and is still a
two-beat comparison, and the beat shape is the stronger evidence.

**Measured** with `cloud/scripts/povmeasure/diff.mjs` (old and new tagger
compiled to CJS, both run over all 196 rows in one process; the script header
says how to rebuild the two sides).

| branch | rows | moved | before | after |
|---|---|---|---|---|
| spoken (>= 4 spoken words) | 109 | **0** | — | unchanged |
| screen | 87 | 15 | text-claim 50, question 15, direct-address 5 | text-claim 45, pov-relatable 15, question 7, direct-address 3 |

The split is on `spokenWords(plain).split(/\s+/).length >= 4`, **not on
`has_speech`**. Three of the 15 moved rows are `has_speech = true` with one
spoken word and take the screen branch; splitting on `has_speech` reports them
as spoken regressions when they are nothing of the kind.

Zero spoken movement is a measurement, not a property of the code — the rule is
live on the spoken branch (a spoken `when he texts you back after three days`
does return `pov-relatable`). No spoken opening in this corpus has the shape.

After deploy + `retag?all=1`: **real hooks on the screen branch 37 -> 43 of 87**,
and 42 of the 65 screen items that actually carry on-screen text now have one.
`cloud/scripts/povmeasure/state.mjs` reprints that from the live database.

---

## The repo is under git — 2026-09-08

Baseline commit `8ab5af8` on branch `main`. **This file is no longer the only
record of change.** Everything from here is recoverable with `git`, so a new
entry below is only needed for something git cannot express — a change made
before a commit exists to record it, or a deliberate copy kept for reading.

Suffix `.pre-git-init`: `.gitignore`. The only file changed by the init, and it
was changed *before* the first commit, so nothing could record the prior state.
The change is two lines: a `# macOS` comment and `.DS_Store`.

**The existing backups are kept, not deleted.** They cost 1.9 MB and the entries
above them are the written reasoning for each change — that account is the
valuable part and it is not reconstructible from a diff.

**Verified before committing:** `config.json`, `secrets/`, `cloud/.env.local`
and `cloud/.vercel` are all untracked, each checked individually with
`git ls-files --error-unmatch`. Staged content was scanned for connection
strings, private keys and secret-shaped literals; every hit was an environment
variable *name* (`R2_SECRET_ACCESS_KEY` in `cloud/src/lib/r2.ts` and the portal
docs), never a value. `vendor/` (1.2G) and `out/` (1.7G) stay out — `setup.sh`
rebuilds the first and the second is generated data. `.git` is 1.8 MB.

There is **no remote**. Nothing has been pushed anywhere; this is local history
only. Adding a remote is a separate decision — the repo is private working
material and pushing it is Geno's call.
