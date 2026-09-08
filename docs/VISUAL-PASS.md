# Phase 7 — the visual pass (on-screen text)

Built 2026-09-06. Read this first; it is the account of what exists.

## Why

The autotagger was 100% text-fed. `TagInput` carried transcript, caption,
first line, speaker count, duration — every field derived from whisper or the
post caption. The only visual artifact in the system was `_thumbnail()` in
`src/worker.py`: one frame, scaled, ~30KB data URL, used purely so the Library
is scannable. **Nothing ever looked at it.**

Measured on `out/` 2026-09-06: **50 of 170 folders (29%) return zero spoken
words.** For those, `hookSuggestions` took a dead branch —

```ts
if (silent) {
  bump(scores, 'text-claim', 0.6)   // every silent video, identically
  ...
}
```

— so all 50 got the same three tags. That cascades: `match.ts` recommends on
`formats`/`hooks`, so silent videos were unrecommendable to any model, and
`brief.ts` drafts from format/hook tags, so their briefs were near-empty.

**Measured before building** (the phase-6 discipline: let the measurement
overturn the brief). OCR over all 50 silent folders: **44 produced on-screen
text — 88%**, at **0.80s per video**. Samples: `POV: Me when boredom strikes`,
`Women showing basic communication skills and empathy / Men: Sex?`,
`how normal people cross their legs: / me:`, `Say YES if you would date 50
years old?`. Those are hook and format signals, not decoration.

## What it is

**Apple's Vision framework, on-device.** No account, no API key, no network —
the same constitution as the rest of the toolchain. `src/ocr/ocr.swift` builds
to `vendor/bin/ocr-text` via `setup.sh` (skipped with a notice if `swiftc` is
absent; the visual pass then simply does not run and everything else is
unchanged).

`src/visual.py` samples 1 fps (cap 24 frames) at 720px, dedups, OCRs the
survivors, and returns a report. It is wired into `pipeline.py` between the
speech pass and diarization.

## Two rules this module is built on

1. **It never raises.** `analyze()` catches broadly and returns a blank report.
   A video with no legible text is an ordinary thing to add, exactly as a video
   nobody speaks in turned out to be. It must never fail a job that already has
   a video and a transcript.
2. **`has_looked` null means "nothing has looked"** — NOT "looked and found no
   text". Identical to the `has_speech` convention, and conflating them re-OCRs
   every wordless video forever.

## Four things measured, worth not re-deriving

1. **Pixel dedup barely fires on this corpus.** It keeps a frame whenever the
   *picture* changes, and in a talking-to-camera reel the person moves while the
   text card holds — so 8/8 and 6/6 frames survived. It is kept because it costs
   nothing and does collapse static clips (3/8 on one), but it is not the
   mechanism that matters here.
2. **The collapse that matters is on the text.** One held POV card came back as
   four readings — `big -`, `big`, `big >`, `big>»` — which is OCR jitter on one
   string. `_dedupe_runs` merges on normalised prefix or `SequenceMatcher >=
   0.85` and keeps the longest variant with the first sighting's timestamp.
3. **You cannot just OCR the poster frame.** One reel read
   `"Why do you look so exhausted?"` then `Meanwhile him last night:` — the
   setup→punchline turn *is* the structure. Single-frame OCR loses it.
4. **`-nostdin` on every ffmpeg call.** ffmpeg reads stdin by default and will
   eat the caller's loop input; this silently truncated folder names during
   testing.

## Persona is deliberately blind to it

OCR returns watermarks, other people's handles, storefront overlays and outright
non-words — `syd | ryd | eyd | syd again` came off a real reel. Persona needs two
hits to stick and is a claim about a person, so screen text is the worst possible
evidence for it. **On-screen text feeds hook and format only.**

The safety property, verified: a noise reading falls through to exactly the
placeholder the system produced before, so the garbage case cannot be worse than
the status quo. The whole-word lexicon is itself the noise filter — non-words
match nothing.

## Known imprecision — fixed on ship, 2026-09-06

`how normal people cross their legs: / me:` classified as `hook:question`
because *how* is in `HOOK_WORDS.question`. It is really a **contrast**. The
comparison shape (`X: / me:`) is common in this corpus, and it was invisible
before because there was no text to be wrong about.

Fixed by `isComparison()` in `autotag.ts` against `HOOK_WORDS.selfReference`:
a caption of two or more beats whose **closing beat is at most six words and
names a person** is a comparison, whatever the first beat opened with. It reads
`on_screen_captions`, so the beats are the ones that were actually read rather
than a re-split of the joined column, and it scores 0.95 — above `question`'s
0.9, because only one hook tag survives `rank` and a tie would keep the wrong one.

Both halves of the test carry weight. Length alone takes `Honorable mention:`
off the end of a listicle; a person word alone takes a closing sentence that
happens to say `I'm`. Measured over the whole library: **12 of 172 hook tags
moved, every one of them to `contrast`, and every one of them on the screen
branch — 0 spoken hooks changed.** That is structural rather than lucky: a
transcript arrives as one string with no beats, so `isComparison` cannot fire
on it.

## What the brief does with it

`brief.ts` drafted its opening quote from the transcript's first line, which is
empty for a video nobody speaks in — so the `hook` field on the model's plan
card, the thing she actually reads, was blank on every one of them.
`openingOf()` now falls back to the first caption beat. Measured: **67 of 172
references gained an opening quote, 84 already had a spoken one, and 21 still
return null** — the contract that a format with nothing honest to say renders
no field at all is intact.

A single-word reading is dropped (`SCREEN_QUOTE_MIN_WORDS`): `ONE`, `PICTURE`,
`LEW:`, `20001` all came back off real reels, and a wrong hook on her card is
worse than an empty one. The floor drops exactly those nine and keeps every
genuine opening, the shortest being `guess my height`.

`isUntouchedDraft` had to grow with it. Those same 67 references now draft
differently from what they drafted last week, and a draft the drafter cannot
recognise is a card it will never touch again. `draftBothFor` therefore drafts
each item twice — once with the screen, once with it withheld — and both forms
count as the drafter's own. Verified: **0 pre-existing cards stranded, against
67 that would have been without it.**

## Files

| File | Change |
|---|---|
| `src/ocr/ocr.swift` | new — Vision OCR, TSV out, never exits non-zero |
| `src/visual.py` | new — sample, dedup, OCR, report |
| `src/relook.py` + `bin/relook` | new — backfill from the copy on disk |
| `src/pipeline.py` | `Options.look`, the stage, `_visual_report` |
| `src/render.py` | `Result.visual` → `transcript.json` |
| `src/worker.py` | `has_looked` / `on_screen_text` / `on_screen_captions` |
| `src/config.py` | `OCR_TEXT` |
| `setup.sh` | builds the binary, rebuilds when the source is newer |
| `cloud/scripts/migrate.mjs` | 3 additive columns |
| `cloud/src/app/api/worker/complete/route.ts` | stores them, `coalesce` so a skipped pass never erases |
| `cloud/src/app/api/worker/unseen/route.ts` | new — `has_looked is null`, silent-first |
| `cloud/src/lib/autotag.ts` | `onScreenText`; `classifyOpening` shared by both paths |
| `cloud/src/lib/tagging.ts` | selects and passes it |

## Deploying it

**Shipped 2026-09-06.** `$WORKER_SECRET` and `$CLOUD_URL` are not shell
variables on this Mac — they are `worker_secret` and `cloud_url` in
`config.json` at the project root, and without reading them out the retag curl
posts an empty bearer and 401s silently:

```bash
CLOUD_URL=$(node -e "process.stdout.write(require('./config.json').cloud_url)")
WORKER_SECRET=$(node -e "process.stdout.write(require('./config.json').worker_secret)")
```

```bash
cd cloud && node scripts/migrate.mjs      # additive columns
vercel deploy --prod
cd .. && ./bin/relook                     # dry run: what would be read
./bin/relook --apply                      # backfill from local copies
curl -X POST -H "Authorization: Bearer $WORKER_SECRET" \
  "$CLOUD_URL/api/retag?all=1"            # re-suggest; human tags untouched
```

`relook` never re-fetches, so a since-gated post is safe. `retag?all=1` replaces
`auto` suggestions wholesale and never touches a tag a human confirmed.


## What the ship measured

- `relook --apply` read all 172 folders: **146 had something written on screen**,
  and **48 of the 54 silent ones (89%)** did — the 88% measured before building.
- Silent videos carrying a hook other than the `text-claim` placeholder went
  from **2 to 24 of 54**. The remainder is lexicon coverage, not OCR: shapes
  like `me when …` and `X VS Y` are read correctly and simply have no tag yet.
- The 88% figure is about **text presence, not hook coverage**. Reading it as a
  target for real hook tags will make a correct result look like a failure.

## Is the matcher used? — yes

The question left open before phase 7. `suggestionsFor` feeds three live
surfaces: the *Suggested for her* rail in `PlanEditor` (which the decline copy
points the operator straight at), `modelsForJob` behind `AssignBar` and
`BulkAssign` on every library item, and the whole of `BatchWeek` — "build a week
for everyone" is the matcher.

Two hypotheses that were carried into the ship are both **wrong**, and are worth
not re-deriving:

1. *The newly-tagged silent videos become recommendable for the first time.*
   They were already recommendable. `formatSuggestions` gives every silent video
   `format:text-overlay`, which is one of the model's formats, so all 54 already
   matched on the format axis. Eligible count was **118 before and 118 after**.
2. *The audit build's `cardinality(matched) > 0` guard suppresses them.* It
   suppresses **4 items, none of them silent**. It is not the blocker.

What actually moved, measured before and after the retag: hook-axis
contribution **38 -> 58 of 118**, mean fit **4.59 -> 4.76**, the `fit = 3` floor
bucket **26 -> 18**, and **8 of the visible top 40 rotated** — all of them silent
videos promoted by a hook tag they had never had.
