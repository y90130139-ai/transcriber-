# Build brief — the audit fixes

Written 2026-09-06 by the session that produced the audit review. Everything a
fresh session needs to build this cold is in this file. Read it end to end
before touching anything.

The review this comes from:
https://claude.ai/code/artifact/538badd3-5348-4408-9729-8a780581712c

## The rules, which are not negotiable

**Additive only.** Nothing that works today gets removed, renamed away, or
traded for something cleaner. This has been said in every session on this
project and it is the thing Geno cares most about. If a change would drop a
feature, it is the wrong change.

**This repo is not under git.** Copy any file into `docs/rollback/` before
overwriting it wholesale, suffixed `.pre-audit`. Note any companion markup
change in `docs/rollback/README.md`.

**Verify before deploying, not after.** Broken layouts have shipped twice on
this project because they were reasoned about instead of looked at. Use
`docs/rollback/cdpshot.mjs`:

```bash
node docs/rollback/cdpshot.mjs <url> <out.png> <0 dark|1 light> <w> <h> [cookie] [full] [steps]
```

`cookie` takes `tx_session=…` for the gated console; `steps` is a JSON array of
expressions evaluated in the page with a pause after each, which is how a screen
behind a tab gets looked at. Get a cookie with:

```bash
cd cloud && PW=$(node --env-file=.env.local -e 'process.stdout.write(process.env.APP_PASSWORD||"")')
curl -s -D- -o /dev/null -X POST http://localhost:3111/api/auth \
  -H 'Content-Type: application/json' \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({password:process.argv[1]}))' "$PW")" \
  | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1
```

**Check both themes every time.** Dark is `0`, light is `1`.

**Audit `var(--sc-*)` against tokens.css after any stylesheet edit.** An
undefined `var()` does not fall back — it invalidates the whole property and
resets it to its initial value. This once set card padding to 0.

```bash
cd cloud && python3 - <<'EOF'
import re, pathlib
d = set(re.findall(r'^\s*(--sc-[a-z0-9-]+)\s*:', pathlib.Path('src/app/tokens.css').read_text(), re.M))
for f in ['plan.css','library.css','globals.css']:
    u = set(re.findall(r'var\((--sc-[a-z0-9-]+)', pathlib.Path('src/app/'+f).read_text()))
    print(f, sorted(u - d) or 'ok')
EOF
```

### Two traps that have already cost a session each

- **`globals.css` and `plan.css` both declare a dark `:root`, and both load on
  `/p/[token]`.** Their token values are byte-identical on purpose. **Edit one,
  edit both.**
- **`.plan-no` is both the `V-1` badge and the decline button.** Any new badge
  rule must be scoped through `.plan-item-head`, or it silently paints the
  decline button. A bare `.plan-no` rule reaches both.

## Rolling back

`docs/rollback/snapshot-2026-09-06-pre-audit-build/` is a complete copy of
`cloud/src`, `cloud/scripts` and `cloud/package.json` from before this work.
87 files. Restore with the `rsync --delete` block in
`docs/rollback/README.md` — `--delete` matters, because a plain copy leaves the
new files behind.

Schema is never rolled back and does not need to be: every column below is a
nullable `add column if not exists`, and code that predates a column simply
never selects it. Do not drop them.

## Deploying

Preview deploys currently cannot build — no Vercel secret is scoped to Preview,
so `/api/bundle` throws on a missing `DATABASE_URL`. Item 7 fixes this; until it
lands, production is the only target.

```bash
cd cloud && node --env-file=.env.local scripts/migrate.mjs   # re-runnable, additive
cd cloud && npx vercel --prod --yes
```

Her plan, for verifying:
https://transcriber-sinauraco-s-projects.vercel.app/p/_JoyHOHboC5VTaoeMu-ec349323T7XTI

Console: https://transcriber-sinauraco-s-projects.vercel.app
(password in `cloud/.env.local` as `APP_PASSWORD`).

## Decisions Geno took on 2026-09-06

- **Delivery is a Google Drive folder per creator**, which they already have
  access to, with the **Telegram marketing channel as the stated alternative**.
  Not an in-portal upload — that stays deferred.
- **Notifications are deferred entirely.** He sends the link manually for now.
  Do not build a channel. Ask whether it is time whenever the portal comes up.
- **Collision guard warns, it does not block.** He sometimes genuinely wants two
  creators on one trend.
- **In scope:** per-model brief overrides, batch week builder, persona backfill.
  **Out of scope:** Spanish/language support.

---

# The work

Ordered so each item is deployable on its own. Deploy and screenshot in
batches, not all fourteen at once.

## Blocking — before creator #2 gets a link

### 1. Delivery instruction on every card

**The finding.** The five standing beats in `PlanView.tsx` end at *"Tick it off
as filmed."* There is no delivery field on the card, the plan or the model.
Nothing anywhere names where the footage goes. This is the one item not to
launch without — it is the failure that costs the relationship rather than the
week.

**Build.**
- Migration: `models.drive_url text`, `models.delivery_note text` — both nullable.
- `ModelSheet.tsx`: a "Where she sends the footage" field pair. Drive URL, plus
  a free-text note defaulting to the Telegram channel wording.
- `MODEL_COLUMNS` in `lib/models.ts` gains both; `readModelInput` validates
  `drive_url` as a URL (`text(body.drive_url, 2000)`) and reads the note.
- `api/models/route.ts` insert and `api/models/[id]/route.ts` update — **append
  new placeholders at the end**, the way `tier` ($18) and `place` ($19) were.
  That file carries a comment explaining why; honour it.
- `lib/plans.ts`: carry both onto the plan payload.
- `PlanView.tsx`: render a delivery block after the card list *and* add a sixth
  standing beat naming it. The card-level render goes under the filmed button in
  `PlanItemCard.tsx` — a short line plus the Drive link as a real tap target.
- Style in `plan.css`, both themes. Reuse the `.plan-cta` treatment rather than
  inventing a control.

**Do not** make the Drive link required to send a plan. A model without one
should render the note alone, and a model with neither renders nothing rather
than an empty box.

### 2. Lift the 90-item ceiling

**The finding.** `src/app/api/library/route.ts` sets `PAGE_SIZE = 90` and ends
every query `limit 90`, and there is **no pagination anywhere in the UI**. 76 of
166 items are unreachable through the grid no matter what you filter on. This is
also what made the original audit's item counts wrong — it read
`ella.goldennn` at 19 items when she has 60.

**Build.** Add real paging: accept `offset`, return the filtered total alongside
`items`, and render a "Load more" in `LibraryTab.tsx` that appends. Keep
`PAGE_SIZE` as the page size — do not just raise the cap to a bigger number and
call it fixed, because the same wall reappears at 500.

The header already reports a held count; make the grid's own count read
`showing N of M` so a truncated view can never again look complete.

### 3. Drop the duplicated standing-rules line

**The finding.** `draftFields()` in `lib/brief.ts` unconditionally appends
`Your standing rules still apply: …` to every card's direction, while
`PlanView` already renders the same rules in the ALWAYS block above. On the live
page *"Never show face. No gym content."* appears twice on one screen, ninety
pixels apart. At twelve cards across five creators that is sixty restatements a
week of a sentence she has already agreed to.

**Build.** Remove that one `lines.push(...)` from **`draftFields` only**.

**Leave `draftBrief` alone.** Two reasons, both load-bearing:
- For items written before phase 3 the prose blob is the entire brief, and the
  rules line is doing real work there.
- "Draft the empty ones" replaces a stored direction *only* when it is still
  byte-for-byte (whitespace-normalised) what `draftBrief` wrote. Changing
  `draftBrief` breaks that comparison and would make the drafter stop
  recognising its own output, stranding every pre-existing item.

After the change, re-draft Test Dummy's cards and confirm the ALWAYS block still
carries the rules and the direction no longer repeats them.

### 4. Fill the brief lookup tables

**The finding.** Wardrobe, camera, takes and caption are all keyed off the item's
format tag in `lib/brief.ts`. Coverage against the 25-format vocabulary:

| Table | Covered | Missing |
|---|---|---|
| Direction (`SHAPE`) | 25/25 | — |
| `WARDROBE` | 22/25 | collab, rage-bait, snap-banner |
| `CAPTION` | 18/25 | **talking-head**, thirst-trap, lip-sync, dance, text-overlay, collab, snap-banner |
| `CAMERA` | 15/25 | thirst-trap, day-in-life, pov-skit, comedy, bts, promo, collab, teaser, skit, rage-bait |
| `TAKES` | 13/25 | q-and-a, fit-check, gym, reaction, bts, promo, collab, teaser, text-overlay, street-interview, rage-bait, snap-banner |

`talking-head` having no caption entry is exactly why the audited plan showed
V-1 "Car talking head" and V-4 "Talking head" with no caption while V-2 "Skit"
had one. It was never inconsistency — one missing key, hit twice.

**Build.** Fill every gap, in the existing voice: short, imperative, specific,
second person, no hedging. Read twenty existing entries first and match them —
they are written to be read on a phone at speed by someone about to film.

**Keep the phase-3 rule intact:** a format with genuinely nothing honest to say
still returns null and the field does not render. Filling a table is not licence
to invent a caption for a format that does not have one. `collab` in particular
may deserve to stay unmapped on caption.

### 5. Suppress unexplainable suggestions

**The finding.** In `lib/match.ts`, FIT is
`3×format + 2×persona + 1×hook + min(outperformance, 3)` with `MIN_FIT = 3`.
The `MATCHED` array — the tags shown to explain a score — collects **only**
format and persona. 36 of 166 items carry neither, only a hook, and can reach 4
on hook weight plus outperformance alone. **Those surface in the FIT rail with a
confident number and a completely empty explanation.** The file's own comment
reads *"a recommendation you cannot explain is one that stops being trusted."*

**Build.** Add a guard requiring a non-empty `matched` array in both
`modelsForJob` and `suggestionsFor` — `cardinality(...) > 0` beside the
`fit >= MIN_FIT` test.

**Guard on the empty explanation, not on word count.** The original audit
proposed excluding anything under five words. That is the wrong axis: it would
drop a genuinely good five-word thirst-trap while keeping a wordy untagged one.
60 items are under five words; 36 are unexplainable; they are different sets.

### 6. Cross-model collision warning

**The finding, and the most likely way the pilot embarrasses him.** `match.ts`
excludes items already on a plan, but the exclusion is scoped
`p.model_id = m.id` — **per model**. With one model that is complete. With ten,
one strong reel is the top suggestion for all ten in the same week and nothing
in the console says so. The scaling plan assumes *"one good reel feeds twenty
creators on a stagger"*; there is no stagger and no view that would surface the
collision.

**Build.** Geno chose **warn, still allow.**
- In `suggestionsFor`, return an `also_on` field: the names and weeks of other
  models already carrying that job. Do not filter it out.
- Render it in the suggestion rail and in the plan editor as a visible flag —
  "already on Ella's week of 8 Sep". Use the existing exception-flag treatment
  from `SweepFlags.tsx` rather than inventing a badge.
- Add a line to the Today sweep listing reels sitting on more than one active
  model's current week.

### 7. Scope the Vercel secrets to Preview

**The finding.** Every secret is scoped to Production and Development only, so a
preview build has no `DATABASE_URL` and throws while collecting page data. Every
change on this project has therefore been verified against production. That is
tolerable while the only creator is a test profile and stops being tolerable the
day a real model holds a live link.

**Build.** Add the existing values to the Preview environment. The values are in
`cloud/.env.local`. **Confirm with Geno before pushing secrets anywhere** — do
not do this unattended.

```bash
cd cloud && npx vercel env add DATABASE_URL preview   # repeat per secret
```

Then prove it: push a preview deploy and confirm it builds.

---

## Before creator #6

### 8. Persona backfill — draft, then approve

**The finding.** Only **44 of 166** items carry a persona tag (26%); 119 carry a
format tag (72%); just **32 (19%) are tagged on all three axes**.
`elfbxby444` (37 items), `viking.barbie` and `jasminlalanii` have zero personas
between them.

**The consequence the original audit missed is bigger than FIT.** Format tags
*author the brief* — wardrobe, camera, takes and caption all key off them. **47
items would brief generically today**, producing a card with four default lines
on it that a creator actually reads.

**Build.** Not a bulk auto-tagger. A draft-and-approve pass:
- A script or console view that proposes persona tags per **source creator**
  (not per item) from their existing tags, transcripts and captions, using
  `lib/autotag.ts` and `lib/lexicon.ts` as they stand.
- Geno approves or corrects per creator in one sitting, and the approved persona
  applies to every item of that creator's.
- Start with the top ten by volume — that covers most of the library.

A persona is a claim about a person and must not be written by a machine
unreviewed. The point of this item is to make approving 10 creators take ten
minutes, not to guess 166 times.

### 9. Bulk assign from the library selection bar

**The finding, correctly scoped.** The single-item path already exists and works
well: open any library item and `AssignBar` (`ItemView.tsx:145`) picks a model
and week, creates the plan if absent, drafts the brief on the way in, and shows
per-model fit scores beside the picker. **Do not rebuild that.**

What is missing is only the bulk path — the multi-select bar in
`LibraryTab.tsx` offers `Download videos` and nothing else, so shortlisting six
reels for one week is six open-assign-close cycles.

**Build.** Add "Add to [model]'s week" to the selection bar, reusing
`AssignBar`'s model/week picker and `/api/plans`. Show the collision warning
from item 6 inline before committing.

### 10. Weekly target consulted by the plan editor

**The finding.** `weekly_target` is stored on the model, editable in her sheet,
and read by **nothing** — not the plan editor, not `sweep.ts`, not the
scoreboard. It is decorative.

**Build.** A non-blocking warning in `PlanEditor.tsx` when the week being sent
falls under her target. Warn, never block — the operator is allowed to send a
short week deliberately.

### 11. Structured decline reasons

**The finding, and what the original audit got wrong about it.** A decline is
**not** a dead end today: `plan_items.decline_reason` is stored and a declined
card already offers a scored replacement in the console. That shipped in phase
2. What is true is that the reason is free prose, so it cannot be counted or
aggregated into a constraint profile.

**Build.** An enum *beside* the free text, never replacing it:
`nowhere-to-film`, `wrong-outfit`, `not-comfortable`, `no-time`, `other`.
- Migration: `plan_items.decline_code text` nullable.
- `PlanItemCard.tsx`: a small chip row above the existing "What got in the way?"
  textarea. Keep the textarea — the prose is often the useful part.
- Surface the counts per model on her sheet, so a creator declining three
  "nowhere to film" in a row becomes visible as a constraint rather than a mood.

### 12. Opened-at on the plan

**The finding.** There is no view or open timestamp. "Sent" and "seen" are the
same state, so when a creator goes silent you cannot tell *never opened the
link* from *opened it and ignored it* — and those need completely different
responses. The sweep's SILENT list therefore cannot tell you which conversation
to have.

**Build.** `plans.opened_at timestamptz` nullable, written on first render of
`/p/[token]` if null. Surface it on the roster card and split the sweep's SILENT
list into "never opened" and "opened, no answer".

Write it from the page route, not from a client effect — a client effect misses
anyone with JS blocked and double-fires in dev.

### 13. Per-model brief overrides

**The finding, and what the original audit got wrong.** Brief fields are **not**
retyped per card — they are already format-level and computed from lookup
tables, and "Draft the empty ones" is that function. That shipped in phase 3.

The genuine gap is one layer up: **the tables are global**, so two creators with
the same format get byte-identical wardrobe lines.

**Build.** A per-model override layer resolving
`model override → format default → global default`. The resolution order already
exists in `draftFields`; this adds one lookup in front of it.
- Migration: a `model_brief_defaults` table keyed `(model_id, format, field)`,
  or a jsonb column on `models` — prefer the table, it is queryable.
- Edited from her sheet, not from the plan editor: these are standing facts
  about her, like standing rules.
- Only ever consulted when drafting. **An override must never rewrite a card
  already authored** — same rule as phase 3's direction replacement.

### 14. Batch week builder

**The finding.** Week creation is per model, per click. At twenty models that is
twenty clicks and eighty hand-authored cards every Monday.

**Build.** Draft every active model's next week in one pass from the existing
fit-ranked suggestions, then review the drafts. This is the Monday fix and it is
the largest item here — build it last, after everything above is deployed and
seen working.

- Respect `weekly_target` per model for how many cards to draft.
- Respect `wont_do` — `match.ts` already hard-excludes it.
- **Apply the collision warning from item 6 across the whole batch**, which is
  the entire reason item 6 comes first. A batch builder without it will hand the
  same reel to every creator in one click.
- Drafts land as unsent plans. Nothing auto-sends, ever.

---

## Deferred, by explicit decision

Do not build these. Listed so they are not rediscovered as gaps.

| Item | Why deferred | What should trigger revisiting |
|---|---|---|
| **Notifications, both directions** | Geno sends the link manually for now | Roster reaching ~5 creators, or the first decline that sits unnoticed for a day. **He asked to be reminded — raise it whenever the portal comes up.** |
| **Spanish / language support** | ~75 brief strings of real translation, not a column | Before the Colombian track starts |
| **In-portal upload replacing the filmed checkbox** | Item 1 gets ~80% of it for an hour's work | After one real pilot week shows what actually went wrong |
| **Results loop into FIT** | Needs posted history to learn from; there is none yet | Once a real roster has a few months of posted results |
| **Roles and audit log** | One operator today | The day a VA authors plans |
| **Multi-tenant boundary** | Single agency | The day this is sold to another agency |
| **R2 retention policy** | Storage is small | Cost becoming visible |

## When it is all in

Update `docs/PORTAL-V2.md` with a section per item in the style already there —
what was found, what was decided, and the traps worth keeping. Update
`docs/rollback/README.md` with the new `.pre-audit` copies and any new files
(deleting a new file is its undo).

Then: pilot on three creators for one full week before the roster goes on. The
pilot's purpose is not to check the plan page renders — that has been verified
repeatedly. It is to force the three failures that cannot happen at n=1: a
collision, a decline nobody noticed, and a Monday spent building three weeks
back to back.
