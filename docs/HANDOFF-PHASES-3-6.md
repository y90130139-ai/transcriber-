# Handoff — build phases 3 through 6

Paste the block below into a fresh Claude Code session.

---

Build phases 3, 4, 5 and 6 of the model portal in `~/projects/social-transcriber`.
Work through them in order, deploying and visually verifying each before starting
the next. Do not ask me to confirm between phases — build all four.

## Read first

`docs/PORTAL-V2.md` is the checklist, the decisions and the history. Phases 1, 2
and 2b are done and deployed. Read it before touching anything.

## The rules, which are not negotiable

**Additive only.** Nothing that works today gets removed, renamed away, or traded
for something cleaner. This has been said in every session and it is the thing I
care most about. If a change would drop a feature, it is the wrong change.

**This repo is not under git.** Copy any file into `docs/rollback/` before
overwriting it wholesale, and note the companion markup change in
`docs/rollback/README.md` if one exists.

**Verify before deploying, not after.** Two broken layouts shipped in earlier
sessions because they were reasoned about instead of looked at. There is no
Playwright here; use Chrome headless, which works:

```bash
# True 390px layout — the naked --window-size flag lays out wider and crops,
# which is why an early screenshot looked fine and the phone did not.
cat > /tmp/frame.html <<'EOF'
<!doctype html><html><body style="margin:0">
<iframe src="PAGE_URL" style="width:390px;height:1500px;border:0;display:block"></iframe>
</body></html>
EOF
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=390,1500 --screenshot=/tmp/shot.png --virtual-time-budget=9000 \
  --blink-settings=preferredColorScheme=0 "file:///tmp/frame.html"   # 0 = dark, 1 = light
```

Then Read the png. **Check both themes every time.**

**Audit tokens after any stylesheet edit.** An undefined `var()` does not fall
back to the previous declaration — it invalidates the property and resets it to
its initial value. `--sc-space-5` was referenced six times and never defined,
which set card padding to 0 and let every child spill to the card edges. That is
what "it looks like a mess" turned out to mean.

```bash
cd cloud && python3 - <<'EOF'
import re, pathlib
d = set(re.findall(r'^\s*(--sc-[a-z0-9-]+)\s*:', pathlib.Path('src/app/tokens.css').read_text(), re.M))
for f in ['plan.css','library.css','globals.css']:
    u = set(re.findall(r'var\((--sc-[a-z0-9-]+)', pathlib.Path('src/app/'+f).read_text()))
    print(f, sorted(u - d) or 'ok')
EOF
```

**Dark mode.** `plan.css` has an ink-ground block at the bottom. Anything that
paints *text* with a ground token (`--sc-bone`) must be restated inside it or it
renders black on black. The console is still light-only until phase 6.

## Deploying

Preview deploys cannot build — no Vercel secret is scoped to Preview, so
`/api/bundle` throws on a missing `DATABASE_URL`. Production is the only target.

```bash
cd cloud && node --env-file=.env.local scripts/migrate.mjs   # re-runnable, additive
cd cloud && npx vercel --prod --yes
```

Only one model exists (`Test Dummy`, 4 items, plan sent), so no real creator is
affected. Her live plan, for verifying:

https://transcriber-sinauraco-s-projects.vercel.app/p/_JoyHOHboC5VTaoeMu-ec349323T7XTI

Console: https://transcriber-sinauraco-s-projects.vercel.app (password in
`cloud/.env.local` as `APP_PASSWORD`).

Design reference, approved:
https://claude.ai/code/artifact/c506be06-e843-4261-a0a7-e8b795a4e696

## Phase 3 — structured brief fields

`lib/brief.ts` already computes wardrobe, camera, takes, sound, length and the
opening quote, then flattens them into one newline-joined prose blob. Un-flatten
it. On her card these become a label/value grid and a tinted hook callout, as in
the reference.

- Add nullable `wardrobe`, `camera`, `takes`, `sound`, `hook`, `caption` to
  `transcriber.plan_items`
- `draftBrief` returns a structured object; keep the prose blob as `notes` so
  nothing already written is lost, and render it as a fallback when the
  structured fields are empty
- `caption` is new — nothing drafts what she actually posts. Draft one, with a
  copy button on her card
- Console gets fields for each in `PlanEditor.tsx`
- The direction currently renders as a list of short lines because `brief.ts`
  joins with `\n`. The reference shows flowing prose. Fix that too.

## Phase 4 — grouping and stable ids

- `plan_items.location` — "In the car", "In the kitchen"
- Group her plan by location, with a shot count per group and a dark section bar
- A stable per-card id that survives the week being edited. Today the list
  renumbers 1..N by position, so "video 7" means something different after any
  edit. The reference shows `V-112`
- Per-item title above the reference ("Car GRWM")
- Console: set location and title per item; suggest a location from the format
  tag where one is obvious

## Phase 5 — operator sweep and scoreboard

- **Daily sweep** — six lists: our side (briefs not sent), filming slipped,
  silent, overdue, unread questions, library health. Nearly all of it is
  computable from columns that already exist
- Exception flags on the roster card — *why* she is red, not just her count
- Due countdown on the card ("2 days left")
- **Scoreboard** — briefs sent on time (us) · accepted · posted. Supply and
  delivery always render together, so nobody gets blamed for a brief that was
  never sent
- **Tap-to-link posts.** Ingest her handle's recent posts as metadata only
  (`jobs.transcribe = false`, no speech pass), show them as a strip in the plan
  editor, and let one tap bind a post to a card, filling `posted_at`/`post_url`.
  Decided explicitly: **no fuzzy auto-matching** — her version of a reference
  shares no key with it, and a wrong guess silently marks a card posted that
  never was
- Tier grouping on the roster (A bespoke / B mixed / C library-only)

## Phase 6 — console restyle

Same treatment as the plan page: dark header block, mono micro-labels, tinted
callouts, real tap targets, rounded corners scoped the way `.plan` scopes them.
Desktop-first but it **must** work on a phone — I approve and review on the go.
Give the console dark-mode support too.

## Style, settled

Corners are **rounded**, chosen over square and hybrid by looking at all three.
This overrides `--sc-radius: 0` for these surfaces; declare the radius on a
container so it cannot leak. Palette is already correct — `tokens.css` is the
reference palette. Never reintroduce blue.
