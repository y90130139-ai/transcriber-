# Model portal v2 — the gosian port

GOSIAN (`~/gosian`, gosian.vercel.app) is **retired** as of 2026-09-05. It was a
test build of what the transcriber's model portal already is. Nothing is being
migrated from it and nothing there is being deleted — it just stops being built
on. Its good ideas are ported here, listed below.

Transcriber is not a subset of it. Four things exist here and never existed
there: auto-drafted briefs from tags (`lib/brief.ts`), fit-scored suggestions
(`api/models/[id]/suggestions`), R2 video delivery to her phone, and transcripts.

## The rule for all of this

**Additive only.** Nothing that works today gets removed, renamed away, or
traded for something cleaner. Every item below either restyles what is already
rendered or adds a field beside it. If a change would drop a feature, it is the
wrong change.

Palette is unchanged — `tokens.css` already *is* the gosian palette (bone
`#EDE9E3`, ink `#0A0A0A`, ember `#C2410C`). Corners stay square per the maison
rule; the app feel comes from layering and contrast, not radius.

## Decisions taken

- **Accepted is hers.** She accepts or declines each card. A decline offers Geno
  a swap from the existing "Suggested for her" scoring rather than sending him
  back to the library.
- **Posted is tap-to-link.** Her handle's recent posts are ingested as metadata
  only (`jobs.transcribe = false`, no speech pass) and shown as a strip in the
  plan editor. Geno taps one to bind it to a card, filling `posted_at` and
  `post_url`. No fuzzy auto-matching — her version of a reference shares no key
  with it, and a wrong guess silently marks a card posted that never was.
- **Both surfaces are responsive.** `/p/[token]` is mobile-first — she only ever
  opens it on a phone. `/console` is desktop-first but must work on a phone,
  because Geno approves and reviews on the go.

## Known blockers

- **Preview deploys do not build.** Every secret on the Vercel project is scoped
  to Production and Development only, so a preview has no `DATABASE_URL` and
  `/api/bundle` throws while collecting page data. Pre-existing, unrelated to
  this work. Either add the vars to Preview or accept that the only deploy
  target is production.
- Only one model exists (`Test Dummy`, 4 items, plan sent). No real creator has
  a live plan link yet, so production is currently low-risk to deploy to.

## Checklist

Nothing is started. Confirm each phase before it begins; tick only what is
deployed and seen working.

### Phase 1 — creator plan restyle (no schema)

**Status: deployed to production 2026-09-05, verified by screenshot.**

The first cut of this shipped broken and it is worth recording why. `plan.css`
referenced `--sc-space-5` six times and **tokens.css never defined it** — the
scale runs 1,2,3,4,6,8,12,16,24. An undefined `var()` does not fall back to the
previous declaration; it invalidates the whole property, which reset
`.plan-item` and `.plan-head` padding to **0**, so every child spilled to the
card edges. Fixed by adding `--sc-space-5: 1.25rem` to the scale, which also
repaired a pre-existing collapsed margin on `.form-row` in the console.

Lesson worth keeping: audit `var(--token)` uses against the tokens file after
touching a stylesheet. One line does it:

```bash
python3 - <<'EOF'
import re, pathlib
d = set(re.findall(r'^\s*(--sc-[a-z0-9-]+)\s*:', pathlib.Path('src/app/tokens.css').read_text(), re.M))
for f in ['plan.css','library.css','globals.css']:
    u = set(re.findall(r'var\((--sc-[a-z0-9-]+)', pathlib.Path('src/app/'+f).read_text()))
    print(f, sorted(u - d) or 'ok')
EOF
```

The header was also recomposed to the sample: the week is the headline, her name
rides with the eyebrow, the facts are one mono line (the old `<dl>` folded into
itself and rendered as `6 SEPTEMBERMON, THU1/4`), and the brief finally has a
DIRECTION label. Rollback: `docs/rollback/plan.css.v1`
plus the `.plan-bar` markup in `PlanView.tsx` — see `docs/rollback/README.md`.

Corners: **rounded**, chosen 2026-09-05 over square and hybrid. This overrides
`--sc-radius: 0` for this surface only; the radius is declared on `.plan` so it
cannot leak into the console.
- [x] Narrow centred column, phone shape at every width
- [x] Dark header block: week, facts, progress
- [x] Segmented progress bar — one tick per item, countable
- [x] Uppercase mono micro-labels over a label/value grid
- [x] Tinted callouts: hook, editing notes, standing rules
- [x] Full-width primary FILMED button, secondary beside it with count badge
- [x] Mono numerals on every figure and id
- [x] Tap targets, no overflow at 320px

### Phase 2 — accept/decline + the Ask thread (schema)

**Status: migration run and deployed to production 2026-09-05.** The backfill
was verified lossless — her one existing note came across as `seed_*` in
`plan_messages`, still unread, with `plan_items.model_note` left in place.
Files touched: `scripts/migrate.mjs`,
`src/lib/plans.ts`, `src/app/api/plan/[token]/message/route.ts` (rewritten),
`src/app/api/plan/[token]/verdict/route.ts` (new), `src/app/api/plans/[id]/route.ts`,
`src/app/api/plans/[id]/items/route.ts`, `src/app/api/models/route.ts`,
`src/components/plan/PlanItemCard.tsx` (rewritten), `src/components/roster/PlanEditor.tsx`,
`src/components/roster/RosterTab.tsx`, `src/components/roster/types.ts`,
`src/app/plan.css`, `src/app/library.css`.
- [x] `plan_items.accepted_at`, `declined_at`, `decline_reason`
- [x] Accept / can't-do control on her card
- [x] Threaded messages per item, replacing the single one-way note box
- [x] **Geno can reply** — today her note lands and there is nowhere for an
      answer to go. This is the one thing in the current build that is broken
      rather than merely plain.
- [x] Unread count badge on the Ask button, both directions
- [x] Declined card offers a scored replacement in the console

### Phase 2b — dark mode (shipped 2026-09-05)

The app had **no** `prefers-color-scheme` rule anywhere. The approved sample was
theme-aware and rendered black on a dark-mode phone while the live page could
only ever render cream, so the two "looked nothing alike" for a reason that had
nothing to do with layout. `plan.css` now carries an ink-ground block, scoped to
the `/p/[token]` route it is imported by; the console is untouched.

Trap when working on it: `.plan-week`, `.plan-name` and `.plan-facts b` paint
with `var(--sc-bone)`, which on the ink ground is near-black. Anything painting
text with a *ground* token has to be restated inside the dark block or it
renders black on black.

- [x] Plan page follows the phone's theme
- [x] Console — shipped in phase 6

### Phase 3 — structured brief fields (small schema)

**Status: deployed to production 2026-09-05, verified by screenshot in both
themes and at 320px.** Files touched: `scripts/migrate.mjs`, `src/lib/brief.ts`,
`src/lib/models.ts`, `src/lib/plans.ts`,
`src/app/api/plans/[id]/route.ts`, `src/app/api/plans/[id]/items/route.ts`,
`src/components/plan/PlanItemCard.tsx`, `src/components/roster/PlanEditor.tsx`,
`src/components/roster/types.ts`, `src/app/plan.css`, `src/app/library.css`.
Rollback copies are `*.pre-p3` in `docs/rollback/`.

- [x] wardrobe / camera / takes / sound as discrete fields
- [x] hook as its own quoted callout
- [x] caption drafted for her, with a copy button
- [x] `brief.ts` un-flattens — `draftFields()` is new beside `draftBrief()`,
      which is untouched and still returns the whole blob. Keep the prose blob
      as fallback for anything unfilled.
- [x] The direction is prose again. `draftBrief` joined its lines with `\n`,
      which rendered on her phone as a stack of disconnected fragments.

Two decisions worth keeping:

- **The caption is drafted only where something honest can be said.** The
  obvious fallback for an unmapped format is the reference's own opening line,
  and handing her their words as her caption is both a duplicate of the hook
  two blocks above it and exactly the confidently-wrong draft `brief.ts` was
  written to avoid. Unmapped formats get no caption and the field does not
  render.
- **"Draft the empty ones" only ever writes into a null.** The one exception is
  the direction, which is replaced *only* when what is stored is still byte-for-
  byte (whitespace-normalised) what `draftBrief` wrote for it — otherwise an
  item drafted before phase 3 would say "Sound: …" twice, once in the prose and
  once in the field. One character of Geno's in there and it is left alone.

### Phase 4 — grouping and stable ids (small schema)

**Status: deployed to production 2026-09-05, verified by screenshot in both
themes and at 320px.** Rollback copies are `*.pre-p4` in `docs/rollback/`.

- [x] `plan_items.location` — "In the car", "In the kitchen"
- [x] Group the plan by location with a shot count per group and a dark bar
- [x] `plan_items.card_no` — stable per-card id, rendered `V-7`
- [x] `plan_items.title` ("Car GRWM") above the reference
- [x] Console sets both; "Draft the empty ones" suggests a location and a title
      from the format tag, and a `<datalist>` offers the locations already in
      use so grouping does not split on a stray capital

Three decisions worth keeping:

- **Groups are runs, not buckets.** Consecutive cards with the same location
  make a group. Sorting the week to collapse two visits to the kitchen into one
  would silently rewrite the order Geno sent her.
- **`card_no` is assigned once, per model, and is not writable from anywhere.**
  An id you can edit is not a stable id. New items read
  `max(card_no) + 1` across every week that model has ever had, inside the
  insert, so a batch numbers itself in order. The backfill counts on from the
  model's existing high-water mark, so a half-numbered roster cannot be handed
  the same id twice.
- **`i.title` is aliased `item_title` in the console query**, because `t.title`
  on the same row is the reference's own title on Instagram.

Grouping only turns on once a location has actually been set. A week with none
renders exactly the flat list it always has.

### Phase 5 — operator sweep + scoreboard

**Status: deployed to production 2026-09-05, verified by screenshot at 1440
and 390.** Rollback copies are `*.pre-p5` in `docs/rollback/`. New files:
`src/lib/sweep.ts`, `src/app/api/sweep/route.ts`,
`src/app/api/models/[id]/posts/route.ts`, `src/components/roster/SweepTab.tsx`,
`src/components/roster/SweepFlags.tsx`.

- [x] Daily sweep — a new **Today** tab. Six lists: our side, waiting on an
      answer, filming slipped, overdue, silent, library health
- [x] Exception flags on the roster card — why she is red, not just her count
- [x] Due countdown on the card ("1 day left" / "due today" / "3 days over")
- [x] Scoreboard: sent on time (us) · accepted · filmed · posted
- [x] Tap-to-link strip for her posts
- [x] Tier grouping on the roster

**One schema addition, against the heading this section used to carry.**
`models.tier` ('A' | 'B' | 'C', default 'B'). Tier cannot be derived: every plan
item is a library reference, so nothing in the data distinguishes bespoke from
library-only. It is a commercial fact about the arrangement and has to be
stated. Everything else in phase 5 is computed from columns that already
existed.

Decisions worth keeping:

- **Our side is the first list and it is marked as ours.** A card that reads
  "4 this week · 0 filmed" says the same thing whether the brief went out on
  Sunday or is still a draft, and the flag most likely to be read as her
  failing is usually ours. The scoreboard puts supply next to delivery for the
  same reason.
- **Paused models are on no list.** Pausing someone is the operator saying "not
  this week"; a sweep that keeps nagging is a sweep that stops being read.
- **On time = the brief was in her hands before the week it is for started.**
  `sent_at at time zone her tz <= week_of`. Sent on the Wednesday is late even
  if she films it.
- **Still no fuzzy post matching.** Her posts are ingested metadata-only
  (`/api/links` now takes `transcribe: false`) and bound by tapping one. A bound
  post is not offered to a second card. Binding carries the post's real
  `upload_date` into `posted_at`, because that is almost never today.
- **The roster fetches `/api/sweep` separately** rather than widening
  `/api/models`, so nothing the grid already rendered can change shape.

### Phase 6 — console restyle

**Status: deployed to production 2026-09-05, verified by screenshot in both
themes at 1440 and 390 — library grid, creators, roster, plan editor, item
reader, Today and the gate.** Rollback copies are `*.pre-p6` in
`docs/rollback/`. Files touched: `src/app/globals.css` (one appended block),
`src/components/Workbench.tsx`, `src/components/Gate.tsx`.

- [x] Same treatment as phase 1, desktop-first but working on a phone
- [x] Console dark mode

Three things worth keeping:

- **`.console` is the scope.** Workbench and Gate are wrapped in one div, and
  every phase-6 rule hangs off it — the mirror of what `.plan` does on her page.
  `tokens.css` still says `--sc-radius: 0` and every other Sinaura surface is
  still square.
- **`--sc-radius` was already the right lever.** `.btn`, `.pill`, `.chip`,
  `.field` and `.player` all read it, so overriding it once on `.console`
  rounded every control without touching a single component rule. Only the
  surfaces — frames, panels, callouts, the reader — needed rules of their own.
- **The dark tokens in `globals.css` are byte-identical to the ones in
  `plan.css`, deliberately.** Both stylesheets load on `/p/[token]` — globals
  from the root layout, plan.css from the route's own — and whichever ends up
  last in the bundle must not change what her page looks like. **If one is ever
  edited, edit both.** Verified after the change: her page renders identically
  in both themes.

The flip rule, restated for the console: a rule painting a *surface* with
`--sc-ink-900` or *text* with `--sc-bone` inverts along with the token. Where
that inversion is what you want — a filled button becoming light-on-dark — it
is left alone. Where the surface must stay ink whatever the theme (`.masthead`,
`.reader-head`, `.selectbar`, `.gate`, and every media well that paints ink
behind a picture that has not loaded) it is restated in the dark block.

## Fixed after phase 6 — the decline button went green

Reported 2026-09-06, deployed the same day. Rollback:
`docs/rollback/plan.css.pre-verdict-fix`.

`.plan-no` was two different things: the `V-1` badge in the card head, and the
"Can't do this" button. A bare `.plan-no` rule reaches both, and
`.plan-item[data-filmed] .plan-no` is (0,2,0) — which beats
`.plan-verdict button` at (0,1,1). So ticking a card filmed painted its decline
button `--sc-positive`. The one control on the page that must never be mistaken
for a yes was green.

Two changes:

- **Every badge rule now goes through `.plan-item-head`**, so it cannot reach
  the button. The class names are unchanged; only the scope is. If a badge rule
  is ever added, add it scoped — a bare `.plan-no` will silently hit the
  decline button again.
- **Both answers now fill when chosen, in opposite colours** — ink for yes,
  `--sc-critical` for no, restated in the dark block because both paint a
  ground token as text. Outlines alone were too close to tell apart on a phone,
  and a decline is the state that most needs Geno to do something about it.

Verified on a card forced into declined *and* filmed at once, in both themes:
red decline sitting directly above a green filmed button.

## Fixed after phase 6 — the timezone picker could not show what was picked

Reported 2026-09-06 with a screenshot, deployed the same day. Rollback copies
are `*.pre-place` in `docs/rollback/`.

Choosing "New York (Eastern)" left the control reading "Connecticut (Eastern)".
Nothing was wrong with the saving: **the zone stored was correct the whole
time**, because Connecticut and New York *are* `America/New_York`. What was
broken was the picker's ability to report the choice back.

`lib/timezones.ts` lists places, not zones — thirty US entries share
`America/New_York` on purpose, so the list can be read by state instead of by
IANA string. But the `<select>` was keyed `value={form.timezone}`. A controlled
select shows the **first** option whose value matches, so picking New York
dispatched `America/New_York`, found state already on `America/New_York`, and
re-rendered onto Connecticut. Every Eastern state collapsed to Connecticut and
every Central one to Alabama; the further down the list a state sat, the more
obviously broken it looked.

The fix is that **the option value is now the place label**, and the zone is
derived from it in the change handler. That makes the values unique, which is
what a select needs to distinguish its options at all.

Keying on the label alone would have fixed only the open sheet — reopening
would read the zone back and land on Connecticut again, which is the same
complaint one round-trip later. So the choice is persisted:
`models.place`, nullable, holding the label. New helpers in `lib/timezones.ts`:
`zoneForPlace`, `isKnownPlace`, `displayPlace`.

Three things worth keeping:

- **The zone is still the only thing anything downstream reads.** `place` is a
  display fact that happens to record what the operator chose. Nothing about
  which week her link opens to, or whether a plan reads overdue, goes near it.
- **`place` is nullable and falls back.** Every model saved before the column
  has `place = null`, and `displayPlace` then returns `placeFor(zone)` — the
  first place sharing her zone, exactly what the picker showed everyone before.
  She is not migrated or rewritten; the real choice sticks from her next save.
- **A label the picker no longer offers is dropped to null, not kept.**
  `readModelInput` stores `place` only if `isKnownPlace`, so editing the list
  can never leave a stored place disagreeing with the zone beside it.

The hand-typed-zone escape hatch still works. Its option now carries `value=""`
and picking it clears `place` while leaving `timezone` untouched, so a model
whose zone was set outside the picker is still never quietly moved a state over.

Verified before deploying, on a real round-trip: picked New York, saved, closed
the sheet, reopened it — "New York (Eastern)", clock reading
`It's Sun 3:08 AM there · America/New_York`, in both themes. `Test Dummy` now
carries `place = 'New York (Eastern)'`; her zone is byte-identical to what it
was.

## The audit build, 2026-09-06

Fourteen items from the audit review, built and deployed the same day in three
batches: 1–7 first because none of them could wait for creator #2, then 8–13,
then the batch builder last. The brief they were built from is
`docs/BUILD-AUDIT-FIXES.md`. Per-file rollback copies are `*.pre-audit` in
`docs/rollback/`; `snapshot-2026-09-06-pre-audit-build/` is the coarse undo.

Every migration is a nullable `add column if not exists` plus one new table.
Nothing was removed, renamed, or traded for something cleaner.

### 1. Delivery instruction on every card

The five standing beats ended at *"Tick it off as filmed."* Nothing anywhere on
the plan, the card or the model named where the footage goes. It is the one
failure that costs the relationship rather than the week.

`models.drive_url` and `models.delivery_note`, both nullable, set from her sheet.
Her page now carries a sixth standing beat, a drop-off line and folder link
under each filmed button, and a delivery block at the foot of the page.

Worth keeping:

- **Neither field is required to send a plan.** A model with a folder and no
  note renders the link alone; with a note and no folder, the note alone; with
  neither, no delivery block at all and five beats rather than six. An empty box
  would be worse than the silence it replaced.
- **The card-level render is the link only.** The note is not restated under all
  twelve cards — it is one sentence at the foot of the page and a short line
  where the question actually comes up.
- **The placeholders in both model routes are appended, never renumbered.** That
  file's own comment explains why: get it wrong and a live model's share link
  rotates silently. `drive_url`/`delivery_note` went on the end the way `tier`
  and `place` did.
- **`readModelInput` validates the URL.** Anything that is not `http`/`https`
  is dropped to null rather than stored — a `javascript:` or a bare
  `drive.com` would render on her phone as a dead or hostile tap target and she
  has no way to tell which.

### 2. The 90-item ceiling

`api/library` set `PAGE_SIZE = 90`, ended every query `limit 90`, and there was
**no pagination anywhere in the UI**. 76 of 166 items were unreachable through
the grid no matter what was filtered on.

The route now takes `offset` and `limit`, returns the filtered `total` beside
`items`, and `LibraryTab` renders a "Load more" that appends. The grid's own
count reads `Showing 90 of 166`, so a truncated view can never again look
complete.

Worth keeping:

- **`PAGE_SIZE` is still 90.** Raising the cap would only move the same wall
  further out. `MAX_LIMIT` (twenty pages) exists to stop a hand-written query
  asking for the whole table, not as a page size.
- **The grid re-requests the span it already has open on every poll.** A
  fifteen-second refresh must not truncate a view somebody deliberately
  expanded, which is why the client sends `limit` rather than paging by offset
  and appending.
- **Any change to the filter or the search resets to page one.** Narrowing to a
  creator while six pages deep would ask for 540 of her 60 and read as a broken
  filter.

The audit's claim that `ella.goldennn` "has 60 items" is not supported by the
data: she has 19, and the library holds 166 rows with no null authors. The
substantive half of the finding — 76 items unreachable — was exactly right.

### 3. The duplicated standing-rules line

`draftFields` appended *"Your standing rules still apply: …"* to every card's
direction while `PlanView` was already rendering the same rules in the ALWAYS
block ninety pixels above. Twelve cards across five creators is sixty
restatements a week of a sentence she has already agreed to.

One `lines.push(...)` removed from **`draftFields` only**.

Worth keeping:

- **`draftBrief` still pushes that line and must keep doing so.** For any item
  written before phase 3 the prose blob is the entire brief, and the rules line
  is doing real work in it.
- **`isUntouchedDraft` now recognises three forms, not one.** It compared the
  stored direction against `draftBrief`'s blob only — but Test Dummy's cards
  were written by `draftFields`, so "draft the empty ones" would not have
  recognised its own output and every existing card would have kept the
  duplicate forever. It now also matches the current field-form direction, and
  the field-form direction *as it was written before this change* — reconstructed
  by `legacyFieldsDirection`. One character of Geno's in there and it still
  fails all three and stays his.

Verified by re-drafting all four of Test Dummy's cards: ALWAYS block still
carries the rules, no direction repeats them.

### 4. The brief lookup tables

Coverage against the 25-format vocabulary was `WARDROBE` 22, `CAPTION` 18,
`CAMERA` 15, `TAKES` 13. `talking-head` having no caption entry is exactly why
the audited plan showed two talking-head cards with no caption while the skit
had one — one missing key, hit twice.

All four tables are now complete, in the existing voice.

Worth keeping:

- **`collab` is deliberately still unmapped on caption.** Every honest caption
  for one names the other person and the library does not know who they are. The
  field returning null and not rendering is the correct answer, not a licence to
  write something she has to delete every time. The phase-3 rule is intact.

### 5. Unexplainable suggestions

FIT is `3×format + 2×persona + 1×hook + min(outperformance, 3)` with
`MIN_FIT = 3`, but `MATCHED` — the tags shown to explain a score — collects only
format and persona. 36 of 166 items carry neither, reach 4 on hook weight plus
outperformance, and surfaced in the rail with a confident number and a
completely empty explanation.

`cardinality(ranked.matched) > 0` now sits beside the `fit >= MIN_FIT` test in
both `modelsForJob` and `suggestionsFor`.

Worth keeping:

- **The guard is on the empty explanation, not on word count.** The original
  audit proposed excluding anything under five words; that would drop a good
  five-word thirst-trap and keep a wordy untagged one. 60 items are under five
  words, 36 are unexplainable, and they are different sets.

### 6. Cross-model collision warning

`match.ts` excludes items already on a plan, but scoped `p.model_id = m.id` —
per model. With one model that is complete. With ten, one strong reel is the top
suggestion for all ten in the same week and nothing said so.

`alsoOn(job, model)` in `match.ts` returns the names, weeks and statuses of
other models carrying a reel. It is rendered by `CollisionFlag` in the
suggestion rail, on plan rows in the editor, in the bulk-assign bar and across
the batch builder, and the Today sweep gained an **On more than one week**
list.

Worth keeping:

- **It warns and never filters.** Geno's decision, 2026-09-06: two creators on
  one trend is sometimes exactly what is wanted. The flag exists so that when it
  happens it is a choice rather than an accident.
- **`CollisionFlag` reuses the sweep's `.rosterflag` treatment** rather than
  inventing a badge, because it is the same kind of statement.
- **The sweep list is scoped to the current week and to active models.** A
  collision on a week that has been and gone is not a thing to do anything about
  today.

### 7. Vercel secrets scoped to Preview

Every secret was Production/Development only, so a preview build had no
`DATABASE_URL` and threw while collecting page data. Every change on this
project had therefore been verified against production.

All eight — `DATABASE_URL`, `SESSION_SECRET`, `APP_PASSWORD`, `WORKER_SECRET`
and the four R2 keys — are now scoped to Preview, on Geno's explicit
instruction. A preview deploy was pushed and built.

Worth keeping:

- **There is one Neon database.** A preview deploy reads and writes the same
  live data production does, including a real model's plan. That was stated and
  accepted before the secrets were pushed.
- **The four R2 values are not in `cloud/.env.local`.** They live in the Mac
  worker's `config.json` under `r2`, which is where they were read from.
- **`vercel env add <name> preview` needs an explicit third argument.** In
  non-interactive mode it refuses without one; passing `""` scopes to all
  preview branches, which is what the suggested command claims to do and does
  not.

### 8. Persona backfill — draft, then approve

Only 44 of 166 items carried a persona tag. The consequence is bigger than a
weak FIT score: format tags author the brief, so an untagged item briefs
generically and hands a creator a card with four default lines on it.

`personaProposal` in `autotag.ts` reads a creator's whole shelf and returns what
the lexicon makes of it *with the phrases that fired*. `GET /api/creators?propose=N`
merges that with the persona tags already on their items. `PersonaBackfill` in
the Creators tab shows one creator at a time with the evidence; approving PUTs
to `/api/creators/[handle]` with `apply: true`, which carries the persona down
onto every post of theirs as `human`.

Worth keeping:

- **The lexicon alone finds almost nothing here.** Eighteen reels can total two
  thousand characters and half the library is barely spoken. The tag evidence —
  "already on 2 of 14 posts, every one of them by hand" — is the stronger claim
  and was going unused entirely. Both legs are shown.
- **Nothing is written until a human approves it.** A persona is a claim about a
  person, and approving one without seeing the evidence is a rubber stamp.
- **`apply` is opt-in.** The creator sheet's own Save still does exactly what it
  always did; only the backfill passes the flag.
- **Approving replaces rather than adds.** Persona is a property of the creator,
  so a correction has to be able to remove what the guess got wrong.
- **Written as `human`, so `/api/retag` can never overwrite it** — that pass
  only replaces its own guesses.

### 9. Bulk assign from the selection bar

The single-item path already existed and works well; it was not rebuilt. What
was missing was only the bulk path — the multi-select bar offered
`Download videos` and nothing else, so shortlisting six reels was six
open-assign-close cycles.

`ModelWeekPicker` was lifted out of `AssignBar` unchanged and is now used by
both. `BulkAssign` sits in the selection bar, checks collisions **before**
committing, then creates the week and appends everything in one call.

Worth keeping:

- **`.selectbar` is an ink surface in both themes** — light theme paints it
  `--sc-ink-900`, the dark block in `globals.css` pins it to `#000`. A select
  inheriting `.pill`'s `ink-500` type is dark on dark, and its arrow is drawn in
  `ink-500` too. Both are restated, in both themes. This was caught on a
  screenshot, not by reading the CSS.
- **Nothing restyles `.btn` inside the bar.** `.selectbar .btn` already states
  what a filled button looks like on that ground; two rules for one button is
  how they drift apart.

### 10. Weekly target consulted by the plan editor

`weekly_target` was stored on the model, editable in her sheet, and read by
nothing. It was decorative.

`PlanEditor` now shows a line above the send control when the week is under her
target. It warns and never blocks — sending a short week deliberately is a
normal thing to do, and the operator is allowed to do it without arguing with a
dialog.

### 11. Structured decline reasons

A decline was never a dead end — the reason was stored and a declined card
already offered a scored replacement. What was true is that the reason is free
prose, so it could not be counted: three "nowhere to film" in a row read as
three bad weeks rather than as one fact about her house.

`plan_items.decline_code`, five buckets in `lib/decline.ts`, rendered as a chip
row **above** the existing textarea on her card and counted per model on her
sheet.

Worth keeping:

- **The textarea stays.** Her own words are usually the useful part and five
  buckets will never hold everything a week can go wrong in.
- **A pre-existing bug was fixed here.** The reason box called
  `answer('declined')` on blur, and since the card was *already* declined the
  toggle in `answer` turned that into `'open'` — so typing why she could not do
  it silently cleared the decline and took her words with it. Writing a verdict
  is now `save(verdict, code, why)`, which never toggles; `answer` computes the
  toggle and calls it. **Anything under a decline must call `save`, not
  `answer`.**
- **`.plan-code` is its own class.** The trap it is avoiding is the one that
  turned the decline button green: `.plan-no` is both the `V-1` badge and the
  decline button, and a bare rule for one paints the other.

### 12. Opened-at on the plan

There was no view or open timestamp, so "sent" and "seen" were the same state.
When a creator went quiet you could not tell *never opened the link* from
*opened it and ignored it*, and those need opposite responses.

`plans.opened_at`, stamped by `markOpened` from the `/p/[token]` page route.
The roster card reads `opened` / `not opened`, and the sweep's SILENT list is
now **Never opened it** and **Opened, no answer**.

Worth keeping:

- **Written from the page route, never a client effect.** A client effect misses
  anyone with JS blocked and double-fires in development, and the whole value of
  this signal is that it survives both.
- **Written once and never moved.** The question is "did the link ever reach
  her", not "when was she last here".
- **A plan sent before the column existed reports null and lands in neither
  list.** Null is not the same statement as false; the column cannot know about
  a week it was not there for.
- **`Sweep.silent` is unchanged and still populated.** The roster card reads it,
  and splitting it in place would have quietly changed what a flag there means.

### 13. Per-model brief overrides

Brief fields are not retyped per card — they are format-level and computed, and
"Draft the empty ones" is that function. The genuine gap is one layer up: the
lookup tables are **global**, so two creators shooting the same format get
byte-identical wardrobe lines.

`transcriber.model_brief_defaults`, keyed `(model_id, format, field)` with `*`
as the format meaning all of hers. `draftFields` resolves
model override → format default → global default. Edited from her sheet, under
**Her own brief lines**.

Worth keeping:

- **A table, not a jsonb column.** "Which of my models have overridden camera"
  is a question worth being able to ask.
- **Consulted only while drafting.** An override never rewrites a card that has
  already been authored — the same contract phase 3 set for the direction.
- **The faceless camera line is the one field an override does not win.** A
  standing rule against being on camera is why that field exists for her at all,
  and the cost of getting the precedence wrong is her face in frame. Her sheet
  says so when her standing rules mention her face.
- **Only a format she actually does, or `*`.** An override for a format she does
  not shoot would never resolve and would sit in her sheet looking like it had
  taken effect.

### 14. Batch week builder

Week creation was per model, per click. At twenty models that is twenty clicks
and eighty hand-authored cards every Monday.

`previewBatch` in `lib/batch.ts` works out what one pass would draft;
`GET /api/plans/batch` returns it and writes nothing; `POST` writes the picks
that came back from the preview. `BatchWeek` sits at the top of the Models tab.

Worth keeping:

- **Nothing auto-sends. Ever.** Every week it opens is a draft, invisible to her
  until somebody marks it sent, and there is deliberately no parameter in the
  route that could change that.
- **Models are taken in tier order and reels are claimed as they go.** When two
  models want the same reel the bespoke tier gets first refusal and the rest are
  staggered onto their next best fit. That stagger is the thing the scaling plan
  always assumed existed and nothing in the console had ever done.
- **A contested reel is held back, not dropped.** If the bench runs out she
  still gets a full week and the duplicate arrives flagged
  (`4 also going to Batch A in this pass`) instead of silent.
- **The picks are sent back from the preview rather than recomputed.** Fit is
  ranked partly on engagement and engagement moves; recomputing on write would
  let what gets written drift from what was looked at.
- **A batch tops a week up, it never replaces one.** `wanted` is
  `target - already`, and the plan insert is `do update set updated_at`.

Verified at n=3 by standing up two temporary models beside Test Dummy: 18 cards
across 3 weeks, all drafts, 14 distinct picks with zero doubling on a wide
bench; then with both temporary models narrowed to two rare formats, 4 picks
correctly flagged as doubled and surfaced again as collision flags in the plan
editor. Both temporary models were removed afterwards.

### Still deferred

Notifications in both directions, Spanish support, in-portal upload, results
feeding back into FIT, roles and an audit log, a multi-tenant boundary, and an
R2 retention policy. See the deferred table in `docs/BUILD-AUDIT-FIXES.md` for
what should trigger revisiting each. **Notifications in particular: Geno asked
to be reminded whenever the portal comes up.**

## Verifying

`docs/rollback/cdpshot.mjs` is the screenshotter these phases were checked with.
It drives Chrome over the DevTools protocol, so the layout viewport and the
capture are the same number by construction — the flaw the bare
`--window-size` flag has, where a page lays out wider than it screenshots and a
narrow shot looks fine while the phone is broken.

```bash
node cdpshot.mjs <url> <out.png> <0 dark|1 light> <width> <height> [cookie] [full] [steps]
```

`cookie` takes `tx_session=…` so the gated console can be seen; `steps` is a
JSON array of expressions evaluated in the page with a pause after each, which
is how a screen behind a tab and a button gets *looked at* rather than reasoned
about:

```bash
node cdpshot.mjs http://localhost:3111/ shot.png 0 1440 1300 "tx_session=…" "" \
  '["[...document.querySelectorAll(\"button\")].find(b=>b.textContent.trim()===\"Models\").click()"]'
```

## Phase 9 — one visual system, and life in it

**Status: deployed to production 2026-09-17** (`dpl_68thqgnvkd1VWwYKeASVUEiABwyj`,
merged to `main` as a fast-forward at `9243b36`). Both aliases verified serving
the new stylesheet (`--sc-spring`, `--sc-lift-3`, `--sc-press` present), the
preview route answering 401 not 404, an unknown `/p/` token still 404,
`.env.local` byte-identical before and after, worker heartbeat 2s. No real
`/p/<token>` was loaded against production: a first load stamps `opened_at`,
and a fake open would corrupt the one signal that distinguishes never-opened
from ignored. Rollback is
git — the tree was clean at `08c1d53` when this started, so `git diff` is the
change and `git checkout -- .` is the undo. (The note at the top of
`docs/rollback/README.md` saying this repo is not under git is **stale**; it is,
and has been since the phase 8 work. No `.pre-p9` copies were made.)

Two complaints, one cause. The plan looked flat and inert next to the rest of
the app, and comparing what Geno was editing to what she would open meant
translating between two designs in his head — her card was a rounded, raised,
padded card with a pill badge, and the console's version of the same item was a
row under a 2px rule with its id in flat grey display type.

### What was built

**A shared motion layer.** New `src/app/motion.css`, imported last by
`globals.css` — the only stylesheet both surfaces are guaranteed to load, since
the root layout imports it on every route including `/p/[token]`. Every control
that can be pointed at or pressed reads its hover and press behaviour from
there, so "what a button does when you touch it" is one answer in one file
instead of two that drift. New tokens in `tokens.css`: `--sc-spring` (the
overshoot), `--sc-dur-slow`, `--sc-rise`, `--sc-press`, and a three-rung
elevation scale `--sc-lift-1..3`.

**Her page got depth and a response.** Elevation on the header, the cards and
the group bars; a warm radial wash in the header block; cards that reveal as
she scrolls to them; the progress ticks pop and bloom as they fill; the filmed
button confirms with a ring that grows out of the card's own edge; the
disclosure markers rotate instead of swapping a glyph.

**The console's plan row is now the same card.** `.console .planrow` mirrors
`.plan-item` — hairline, paper, padding, lift — and `.planrow-no` is the pill
badge her card wears. Radius stays the console's 12/8 against her page's 14/10:
the same system at two sizes, not the same screen.

**The profile sheet actually floats.** `.sheet` had no radius at all — phase
6's radius list never reached it — so the one panel literally floating above
the page was the sharpest-cornered thing in the app. Now hairline + `lift-3` +
a blurred scrim, arriving with a scale rather than a slide, and leaving with
one: `ModelProfile` holds the unmount for the length of the exit animation.

**And the preview, which is the actual fix for "make them identical".**

### The preview is not a mock-up

`PlanPreview` renders `PlanView` — the same component `/p/[token]` renders —
inside a phone frame beside the editor, fed by `/api/plans/[id]/preview`. There
is no second implementation to keep in sync. That is the whole design: the two
surfaces cannot drift apart because there is only one of them.

Three things worth keeping:

- **`loadPlan` could not be reused, and the reason matters.** It answers "what
  should she be looking at *right now*", which means sent plans only, within a
  fortnight of this week — drafts are invisible to her by design. The preview's
  entire purpose is looking at a draft *before* sending it. So the item query
  was extracted to `planItemsFor(planId)` in `plans.ts` and a second entry point
  `loadPlanPreview` was added in a **new file**, `lib/preview.ts`. It is not in
  `plans.ts` because that file opens by promising no query in it takes an id
  from the request, and that promise has to stay literally true.
- **The preview cannot write.** `preview` threads from `PlanPreview` through
  `PlanView` into every `PlanItemCard`, where each of the four mutations returns
  before its fetch. Every control still responds exactly as it will under her
  thumb; none of them post. This is a hard requirement, not a nicety — the
  console previews **real creators' live weeks**, and a preview that wrote would
  tick her cards filmed, answer her verdicts and send her messages from Geno's
  screen while he was only looking. Verified by driving every control in the
  preview with the network recorded: zero mutating requests, and the database
  unchanged afterwards.
- **It refetches rather than mirroring the editor's local state.** What it must
  show is what is *stored*, because that is what her page will load. A field
  typed and not yet blurred has not been saved and must not appear as though it
  had. The `revision` counter is keyed off `plan` and `items`, which are
  replaced by reference exactly when a save succeeds — so it cannot fall behind
  by someone forgetting to bump it in a tenth mutation.

### Three bugs found by looking, worth recording

- **The reveal stranded cards.** An IntersectionObserver only reports what is
  intersecting *now*, and a jump from below the viewport to above it is ratio 0
  → ratio 0 — not a change, so no callback ever fires. Jumping to the foot of a
  26-card week left **11 cards permanently invisible**. Fixed by growing the
  observer's root upward past the top of the document, which makes "scrolled
  past" the thing that reveals an item. The size matters: a flat `9999px` still
  stranded four, because at ~1,400px per card they sat 15,000px up. It is now
  measured from `document.scrollHeight` plus slack.
- **`.sheet-cover` must never be rounded.** It looks like the top of the panel
  and is not — `.sheet-topbar` is, sticky at `top: 0`, with the cover starting
  56px below. Rounding it curved an edge in the *middle* of the panel and bit a
  cream notch out of the black. `.sheet` sets `overflow-y: auto`, so it already
  clips every child to its own corners; nothing inside needs to round itself.
- **The pill badge cost the console row 35px on a phone** and the reference's
  name truncated to "TEX…". The first fix reserved a 56px `grid-template-areas`
  column for the thumbnail — not having noticed that library.css's own ≤720px
  block sets `.planrow img { display: none }`, because the console drops
  thumbnails on a phone on purpose. It held a gutter open for a picture that is
  never drawn. One column below 720px sidesteps it: a hidden child takes part in
  no layout at all.

### The dark blocks had already drifted

Phase 6 says the dark `:root` in `globals.css` and the one in `plan.css` are
byte-identical on purpose and that editing one means editing both. They were
not: `globals.css` carried `--sc-rule-lock` and `plan.css` did not. Nothing
under `.plan` reads it, so it was never a visible bug — but the invariant is
only useful if it is true. Restored, and the three new `--sc-lift-*` tokens went
into both. They now carry 20 identical declarations; the check is in "Verifying"
below.

### Verified

Typecheck and production build clean. Her page at 320/375/390/768/1024/1440 in
both themes with no overflow at any width. The console at 390/768/1024/1120/1440
— the preview pane goes two-column at 1120 and stacks below it. Reduced motion
confirmed to remove every transform while keeping colour and shadow, and to
leave all 26 cards visible rather than hidden. Every card confirmed visible
after both a gradual scroll and an instant jump to the bottom of a 36,000px
page.

**One pre-existing bug found, kept out of this diff, fixed separately after
deploy:** the console's document was 407px wide against a 390px window. It was
first blamed on `.rosterflag`'s `white-space: nowrap` — **that diagnosis was
wrong.** Measured element by element, every flag ends by x=190; the overflow was
`.roster-head-actions` (the week label plus "Add a model" held on one line, right
edge 407 at both 320 and 390). The fix lets that row wrap, right-aligned, with
`min-width: 0`. Document now equals the window at 320/375/390/768/1440, with no
mutating requests during the check. At 320 the "Today" tab runs past the edge
inside the tab bar without widening the page — unchanged, and not this bug.

### Two checks to run after touching either stylesheet

The `var(--token)` audit from phase 1, now covering `motion.css`, and a
comparison of the two dark `:root` blocks that strips comments before diffing —
a naive line diff reports the prose as a difference and hides a real one:

```bash
cd cloud && python3 - <<'EOF'
import re, pathlib
defined = set(re.findall(r'^\s*(--sc-[a-z0-9-]+)\s*:',
              pathlib.Path('src/app/tokens.css').read_text(), re.M))
for f in ['plan.css','library.css','globals.css','profile.css','motion.css']:
    used = set(re.findall(r'var\((--sc-[a-z0-9-]+)', pathlib.Path('src/app/'+f).read_text()))
    print(f, sorted(used - defined) or 'ok')

def decls(p):
    t = pathlib.Path(p).read_text(); i = t.find('@media (prefers-color-scheme: dark)')
    body = re.search(r':root\s*\{(.*?)\n  \}', t[i:], re.S).group(1)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    return sorted(re.sub(r'\s+',' ',d).strip()
                  for d in re.findall(r'(--[a-z0-9-]+\s*:\s*[^;]+);', body))
print('dark :root identical:', decls('src/app/globals.css') == decls('src/app/plan.css'))
EOF
```
