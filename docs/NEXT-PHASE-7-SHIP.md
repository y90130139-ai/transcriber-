# Handoff — ship phase 7, then tasks 2–4

Written 2026-09-06 by a session that hit the cost guard at $211 before starting.
Nothing below has been done yet. **No files were changed and nothing was
deployed in that session** — the working tree is exactly as phase 7 left it.

Read `docs/VISUAL-PASS.md` first; it is the account of what phase 7 is. Then
`~/.claude/projects/-Users-geno/memory/social-transcriber.md`. This file is the
delta on top of both.

## Verified state, do not re-derive

- Phase 7 is **built and verified, not deployed**. tsc clean, `next build`
  exit 0, `/api/worker/unseen` registered, a full pipeline run confirmed
  producing `has_speech:false` + `has_text:true`.
- `vendor/bin/ocr-text` **is built** (67 KB, 2026-09-06 05:22). `swiftc` was
  present, so the visual pass is live locally.
- `bin/relook` and `bin/relisten` both exist.
- The repo has **no git**. There is nothing to commit; changes live on disk.
  Copy anything you overwrite wholesale into `docs/rollback/` first, suffixed
  `.pre-phase7-ship`, and add it to `docs/rollback/README.md`.

## Constraint from Geno — spend no money

Every step here is free: on-device OCR, rule-based tagging, additive columns.

- **Do NOT touch R2.**
- **Do NOT run any `vercel` store command** (`vercel blob …`, `vercel env …`,
  anything under `vercel store`). They trigger an implicit `env pull` that
  **overwrites `cloud/.env.local`**. A backup of the current file is at
  `/tmp/env.local.backup` (1783 bytes, 2026-09-06 05:33) — if it gets clobbered,
  restore from there. `vercel deploy --prod` is fine and is the only vercel
  command needed.
- If anything would incur a charge, **stop and ask**.

## Trap in the deploy commands as written

The published recipe uses `$WORKER_SECRET` and `$CLOUD_URL`. **Those are not
shell environment variables on this Mac.** They live in `config.json` at the
project root, as `worker_secret` and `cloud_url`. Read them out rather than
assuming the shell has them, or the retag curl silently posts an empty bearer
and 401s:

```bash
cd ~/projects/social-transcriber
CLOUD_URL=$(node -e "process.stdout.write(require('./config.json').cloud_url)")
WORKER_SECRET=$(node -e "process.stdout.write(require('./config.json').worker_secret)")
```

`cloud_url` is `https://transcriber-sinauraco-s-projects.vercel.app`. That is one
of two aliases on the single `transcriber` project — the other is
`transcriber-ten-zeta.vercel.app`. The hashed URL `vercel deploy --prod` prints
is that deployment's permanent address, **not a new project**; say so before
pasting it, Geno has been alarmed by it before.

---

# TASK 1 — ship it

```bash
cd ~/projects/social-transcriber/cloud && node scripts/migrate.mjs   # 3 additive columns
npx vercel deploy --prod
cd .. && ./bin/relook                 # DRY RUN FIRST — report the count before applying
./bin/relook --apply                  # backfills from local copies, never re-fetches
curl -X POST -H "Authorization: Bearer $WORKER_SECRET" "$CLOUD_URL/api/retag?all=1"
```

`relook` never re-fetches, so a since-gated post is safe. `retag?all=1` replaces
`auto` suggestions wholesale and never touches a tag a human confirmed.

**Then report:** how many of the 50 silent videos gained a *real* hook tag —
i.e. something other than the old `text-claim` placeholder every one of them
used to get identically. The measured expectation from before the build is
**44 of 50 produced on-screen text (88%)**, so a real-hook count materially
below that is a signal something did not land, not a result to accept.

Spot-check 5 in the Library UI. Screenshot before believing it — this project
has shipped broken layouts twice by reasoning instead of looking.
`docs/rollback/cdpshot.mjs` is the screenshotter:

```bash
node docs/rollback/cdpshot.mjs <url> <out.png> <0 dark|1 light> <w> <h> [cookie] [full] [steps]
```

Cookie for the gated console (note: `--env-file` reads `cloud/.env.local`):

```bash
cd cloud && PW=$(node --env-file=.env.local -e 'process.stdout.write(process.env.APP_PASSWORD||"")')
curl -s -D- -o /dev/null -X POST "$CLOUD_URL/api/auth" -H 'Content-Type: application/json' \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({password:process.argv[1]}))' "$PW")" \
  | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1
```

Check **both themes** — dark is `0`, light is `1`.

---

# TASK 2 — the comparison shape misclassifies

The most common hook shape in this corpus currently returns the wrong tag.

Real strings, both of which return `hook:question` today and are actually
**contrast**:

- `how normal people cross their legs: / me:`
- `Women showing basic communication skills and empathy / Men: Sex?`

Cause: `how` is in `HOOK_WORDS.question`, and the question branch wins.

**Fix in `cloud/src/lib/lexicon.ts` plus the contrast branch of
`classifyOpening()` in `cloud/src/lib/autotag.ts`.** The rule: a two-beat
caption whose **second beat is a short self-reference** (`me:`, `Men:`,
`meanwhile you:`) is contrast, not a question — regardless of what the first
beat opens with.

**Use `on_screen_captions`.** It is a jsonb column that already stores the beats
separately; that is what it exists for. Do not re-split a joined string.

Re-run `retag?all=1` afterwards. **Verify against the two real strings above
before and after** — print the tag each one resolves to, both ways round. A test
that only asserts the new behaviour proves nothing about what it broke.

`classifyOpening` is shared by the transcript path and the OCR path, so a change
here moves spoken hooks too. Check a handful of spoken items did not regress.

---

# TASK 3 — is phase 4 matching actually used?

This is the open item from before phase 7 and it is a **question, not a build**.

`cloud/src/lib/match.ts` and `/api/models/[id]/suggestions` match on the
`formats` / `hooks` arrays. The 44 newly-tagged silent videos should therefore
have just become recommendable **for the first time** — before this they carried
only the identical placeholder and could match nobody.

Measure whether suggestion quality actually moved. Something like: suggestion
counts and fit distribution per active model, before and after the retag.

**If the feature is dead in the UI, say so rather than polishing it.** Geno's
words. Do not build on top of a surface nobody opens.

Context worth knowing: an audit build on 2026-09-06 added a `cardinality(matched) > 0`
guard to both `modelsForJob` and `suggestionsFor`, so a suggestion that cannot be
explained is now suppressed entirely. **Newly OCR-tagged videos will only surface
if their new tags land on the `format` or `hook` axis** — a hook-only item still
has an empty `matched` array (that array collects format and persona only) and
will stay suppressed. That is the single most likely reason a measured lift comes
back at zero, and it is worth checking first rather than concluding the matcher
is dead.

---

# TASK 4 — briefs (ONLY if 1–3 land clean)

`cloud/src/lib/brief.ts` drafts from format/hook tags plus the transcript's
first line. **For a silent video that first line is empty**, so those briefs read
generically. Feed `on_screen_text` in as the opening so they stop.

This is the actual payoff — it is what the model reads on her plan card.

Two contracts that must survive:

- **A format with genuinely nothing honest to say still returns null** and the
  field does not render. Filling a gap is not licence to invent.
- **An override or a new input must never rewrite a card already authored.**
  `isUntouchedDraft` in `cloud/src/lib/models.ts` now recognises three forms the
  drafter has written over time; adding a fourth source of opening text means
  checking that comparison still holds, or existing cards get stranded.

---

# DO NOT — load-bearing, see docs/VISUAL-PASS.md

**Never feed on-screen text to the persona axis.** OCR returns watermarks,
foreign storefront overlays and outright non-words — `syd | ryd | eyd` came off
a real reel. Persona needs two hits and is a claim about a person; screen text is
the worst possible evidence for it. **Hook and format only.**

The verified safety property is that a noise reading falls through to exactly
the placeholder the system produced before, so the garbage case cannot be worse
than the status quo. Feeding persona breaks that property.

# Other traps carried forward

- **`-nostdin` on every ffmpeg call.** It reads stdin by default and eats the
  caller's loop input; this silently truncated folder names during testing.
- **`has_looked` null means "nothing has looked"**, not "looked and found no
  text" — same convention as `has_speech`. Conflating them re-OCRs every
  wordless video forever.
- **Regexes inside JS template literals eat their own backslashes** (`\d` → `d`).
  SQL fragments with regexes live in `cloud/src/lib/sql.ts` with doubled
  backslashes.
- **Neon returns `count(*)` as a string.** Cast `::int` anywhere two counts are
  added.
- **After any stylesheet edit, audit `var(--sc-*)` against tokens.css** — an
  undefined `var()` does not fall back, it invalidates the whole property. The
  one-liner is in `docs/BUILD-AUDIT-FIXES.md` under "The rules".
- **`.plan-no` is both the `V-1` badge and the decline button.** Any new badge
  rule must be scoped through `.plan-item-head`.
- **`globals.css` and `plan.css` both declare a dark `:root` and both load on
  `/p/[token]`.** Edit one, edit both.

# Reminder Geno asked for

**Notifications are still deliberately deferred** and he asked to be reminded
whenever the model portal comes up. The trigger he named was a roster reaching
~5 creators, or the first decline that sits unnoticed for a day. The roster is
currently one creator (Test Dummy).
