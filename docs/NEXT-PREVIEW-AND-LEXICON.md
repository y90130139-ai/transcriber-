# Handoff — blank suggestion cards, then the hook lexicon gap

Written 2026-09-06 by the session that shipped phase 7. That ship is **done and
deployed**; read `docs/VISUAL-PASS.md` for the account of it. Nothing below has
been started. **No files were changed for either task** — the working tree is
exactly as the phase 7 ship left it, tsc clean.

Do them in this order. Task A is smaller and improves the surface you would be
judging Task B from.

## Constraint from Geno — spend no money

Both tasks are free: rule-based, on-device, additive.

- **Do NOT touch R2.**
- **Do NOT run any `vercel` store command** (`vercel blob …`, `vercel env …`,
  anything under `vercel store`). They trigger an implicit `env pull` that
  **overwrites `cloud/.env.local`**. Backup at `/tmp/env.local.backup`
  (1783 bytes). `vercel deploy --prod` is fine and is the only vercel command
  needed. Diff the two after every deploy; it stayed intact all through phase 7.
- If anything would incur a charge, **stop and ask.**

## Deploy recipe — the trap that 401s silently

`$WORKER_SECRET` and `$CLOUD_URL` are **not shell variables on this Mac.** They
live in `config.json` at the project root as `worker_secret` and `cloud_url`.
Without reading them out, the retag curl posts an empty bearer and 401s with no
visible error:

```bash
cd ~/projects/social-transcriber
CLOUD_URL=$(node -e "process.stdout.write(require('./config.json').cloud_url)")
WORKER_SECRET=$(node -e "process.stdout.write(require('./config.json').worker_secret)")
cd cloud && npx vercel deploy --prod
curl -s -X POST -H "Authorization: Bearer $WORKER_SECRET" "$CLOUD_URL/api/retag?all=1"
```

`cloud_url` is `https://transcriber-sinauraco-s-projects.vercel.app`. It and
`transcriber-ten-zeta.vercel.app` are two aliases on the **one** `transcriber`
project. The hashed URL `vercel deploy --prod` prints is that deployment's
permanent address, **not a new project** — say so before pasting it, Geno has
been alarmed by it before.

The repo has **no git**. Copy anything you edit into `docs/rollback/` first,
suffixed `.pre-preview-lexicon`, and add it to `docs/rollback/README.md`.

---

# TASK A — the suggestions rail shows blank cards

**Measured on the live API, 2026-09-06: 13 of the top 40 suggestions for Test
Dummy render with no description line at all.**

`PlanEditor.tsx:418` is `{item.preview && <p className="planrow-line">{item.preview}</p>}`
— so when `preview` is empty the line is simply absent and the card shows author
and duration and nothing about what the video *is*. That hits exactly the videos
phase 7 just made competitive: `preview` comes from the transcript, which is
empty for a video nobody speaks in.

`suggestionsFor` in `cloud/src/lib/match.ts` selects it as:

```ts
${preview('t.plain', 150)} as preview
```

`preview()` lives in `cloud/src/lib/sql.ts`:

```ts
const TURN_PREFIX = `'\\[\\d+:\\d{2}(:\\d{2})?\\]\\s*(Speaker\\s*\\d+\\s*:\\s*)?'`
export function preview(column: string, length: number): string {
  return `left(regexp_replace(coalesce(${column}, ''), ${TURN_PREFIX}, '', 'g'), ${length})`
}
```

**The fix:** fall back to `t.on_screen_text` when the stripped transcript is
empty — same idea as `openingOf()` in `brief.ts`, which phase 7 added for the
brief's hook field. A `coalesce(nullif(trim(<stripped plain>), ''), <screen>)`
shape does it in SQL without a second round trip.

Things to hold onto:

- **Doubled backslashes.** `TURN_PREFIX` is inside a JS template literal, so
  Postgres must receive `\d` and `\s`, not `d` and `s`. Any new regex fragment
  goes in `sql.ts` and doubles its backslashes. This has bitten before.
- **`on_screen_text` joins its beats with ` | `.** For a card preview those pipes
  should collapse to spaces, the way `openingOf()` does it in `brief.ts`.
- **Check the other callers of `preview()` before changing its signature.** Grep
  it; the library grid and hot rail use it too, and a silent video showing its
  screen text there is probably right as well — but that is a decision to make
  deliberately, not a side effect.
- Consider whether a one-word OCR reading (`ONE`, `PICTURE`, `20001` — all off
  real reels) should reach a card at all. `brief.ts` has
  `SCREEN_QUOTE_MIN_WORDS = 2` for exactly this and the reasoning is written
  there.

**Verify by looking, not by reasoning** — this project has shipped broken
layouts twice by reasoning. Re-run the count above after deploying and expect it
to drop toward 0, then screenshot the rail in **both themes**.

---

# TASK B — the hook lexicon under-covers the corpus

After the phase 7 ship, **24 of 54 silent videos carry a real hook tag; 30 still
land on the `text-claim` placeholder.** That remainder is lexicon coverage, not
OCR: the text was read correctly and simply has no tag for its shape.

**Do not read the 88% figure as a target for this number.** 88% was measured
about *text presence* — 48 of 54 silent videos (89%) did produce on-screen text,
exactly as predicted. Conflating the two makes a correct result look like a
failure; the previous handoff did, and it cost time.

Shapes visible in the OCR with no tag today:

| Real string | Today | Should be |
|---|---|---|
| `me when the nice nerdy guy starts talking ab cnc` | `text-claim` | relatable / POV |
| `POV: Me when boredom strikes and I have nothing to do` | `text-claim` | POV |
| `getting dressed infront of my best friend VS... my guy best friend` | contrast ✅ (beat rule caught it) | — |
| `"ur either good at top or good at bowling" VS ...` | `text-claim` | contrast — `VS` is not in the lexicon |
| `Him: "I have a surprise for you" / The surprise:` | `text-claim` | contrast |
| `"Baby / Honey / Sweetie" Bitch` | `text-claim` | contrast |

Where the machinery is:

- `cloud/src/lib/lexicon.ts` — `HOOK_WORDS`. Phase 7 added `selfReference`.
- `cloud/src/lib/autotag.ts` — `classifyOpening()` and `isComparison()`.
  `isComparison` fires on `on_screen_captions` beats: two or more beats whose
  closing beat is ≤ `PUNCHLINE_WORDS` (6) and contains a `selfReference` word.
  `VS` inside a single beat is a different shape and needs its own rule.
- `MAX_PER_AXIS.hook = 1` — **only one hook tag survives `rank`.** A new tag must
  out-score the incumbent, not merely tie it. `question` is 0.9 and
  `COMPARISON_SCORE` is 0.95 for exactly this reason.
- `KEEP_ABOVE.hook = 0.45` is the floor to clear at all.
- Check `cloud/src/lib/taxonomy.ts` before inventing a tag — `isValidTag` filters
  suggestions, so a tag not in the taxonomy is silently dropped.

## The rule that is load-bearing — do not break it

**Never feed on-screen text to the persona axis. Hook and format only.** OCR
returns watermarks, foreign storefront overlays and non-words — `syd | ryd |
eyd` came off a real reel. Persona needs two hits and is a claim about a person.
The verified safety property is that a noise reading falls through to exactly
the placeholder the system produced before, so the garbage case cannot be worse
than the status quo. Feeding persona breaks that property.
`personaSuggestions` carries the comment explaining this; leave it there.

## Verify the way phase 7 was verified

`classifyOpening` is shared by the transcript path and the OCR path, so any
lexicon change moves **spoken** hooks too. Phase 7's beat rule was provably
screen-only (a transcript has no beats); adding words to `HOOK_WORDS` is **not**.
So measure both sides before and after.

The harness that did this, worth rebuilding rather than re-inventing:

```bash
cd ~/projects/social-transcriber/cloud
mkdir -p .tmpq && cp ../docs/rollback/*.pre-* .tmpq/oldsrc/lib/   # the old files
npx tsc src/lib/autotag.ts --ignoreConfig --outDir .tmpq/new \
  --module commonjs --target es2022 --skipLibCheck
# same for the old copy into .tmpq/old, then in each dir:
echo '{"type":"commonjs"}' > .tmpq/new/package.json
```

Then a `.mjs` in `.tmpq/` that `createRequire`s both builds and runs them over
every row, splitting the diff by branch. Two things make this work:

- **Scripts must live inside `cloud/`** or `@neondatabase/serverless` will not
  resolve. A script in `/tmp` fails with `ERR_MODULE_NOT_FOUND`.
- Run with `node --env-file=.env.local <script>`.
- `--module commonjs` is what makes extensionless imports resolve; Node's ESM
  will not. tsc prints a `moduleResolution` error but still emits — ignore it.

The number that mattered for phase 7 was **"transcript-branch hooks changed: 0"**.
Split on `spokenWords(plain).split(/\s+/).length >= 4` (`SILENT_WORDS`), not on
`has_speech` — several rows are `has_speech = true` with one spoken word and take
the screen branch anyway. Getting that wrong makes three screen-branch items look
like spoken regressions.

Re-run `retag?all=1` after deploying, then re-measure real hooks per axis.

## Useful queries

`transcriber.tags` columns are `job_id, axis, tag, origin, score` — **`origin`,
not `source`.** Neon returns `count(*)` as a string; cast `::int` anywhere two
counts are added.

```sql
-- real hooks on silent videos (the number to move; 24 of 54 today)
select coalesce(array_agg(tg.tag) filter (where tg.axis='hook' and tg.origin='auto'), '{}')
  from transcriber.transcripts t
  left join transcriber.tags tg on tg.job_id = t.job_id
 where t.has_speech is false group by t.job_id;
```

## Screenshots

```bash
node docs/rollback/cdpshot.mjs <url> <out.png> <0 dark|1 light> <w> <h> [cookie] [full] [steps]
```

The console is at `/` (there is exactly one Next page, `/p/[token]`; everything
else is client tabs, so `/library` 404s — click the nav instead via `steps`).
Cookie:

```bash
cd cloud && PW=$(node --env-file=.env.local -e 'process.stdout.write(process.env.APP_PASSWORD||"")')
curl -s -D- -o /dev/null -X POST "$CLOUD_URL/api/auth" -H 'Content-Type: application/json' \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({password:process.argv[1]}))' "$PW")" \
  | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1
```

Reaching the plan card takes three `steps`: click `MODELS`, then `PLAN`, then the
week. To see a drafted card without touching the sent plan, `POST /api/plans`
with `{model_id, week_of, job_id}` creates an **unsent** week (invisible to the
model), and `DELETE /api/plans/<id>` removes it — phase 7 verified Task 4 that
way and left the database back at 1 plan / 4 items.

## Other traps carried forward

- **`-nostdin` on every ffmpeg call.** It reads stdin by default and eats the
  caller's loop input; this silently truncated folder names during testing.
- **`has_looked` null means "nothing has looked"**, not "looked and found no
  text" — same convention as `has_speech`.
- **After any stylesheet edit, audit `var(--sc-*)` against tokens.css** — an
  undefined `var()` does not fall back, it invalidates the whole property. The
  one-liner is in `docs/BUILD-AUDIT-FIXES.md` under "The rules".
- **`.plan-no` is both the `V-1` badge and the decline button.** Any new badge
  rule must be scoped through `.plan-item-head`.
- **`globals.css` and `plan.css` both declare a dark `:root`** and both load on
  `/p/[token]`. Edit one, edit both.

## Reminder Geno asked for

**Notifications are still deliberately deferred**, and he asked to be reminded
whenever the model portal comes up. The triggers he named were a roster reaching
~5 creators, or the first decline that sits unnoticed for a day. The roster is
one creator (Test Dummy). Note that the 31 August plan **already** carries one
turned-down item with an empty slot and a 3-message unread thread — that reads as
his own testing rather than a real creator going unanswered, but the condition is
technically met and he knows.
