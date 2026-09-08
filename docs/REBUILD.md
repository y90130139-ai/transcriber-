# social-transcriber — the whole thing, from zero

A complete rebuild guide. Written 2026-09-07 so that somebody who has never seen
this project can build it again from an empty folder, understand *why* each
piece is shaped the way it is, and then take it somewhere else.

## How to read this

Every phase below is a **stopping point**. Phase 1 alone is a useful tool. Phase
3 alone is a useful tool. Nothing later is required to make anything earlier
work. Build in order, stop wherever the value runs out for you.

Where a decision was made against a measurement, the measurement is quoted. Take
your own — the numbers are from one Mac and one 172-video library, and some of
them will not hold for you. Where something is a *rule* rather than a
preference, it says so and says what breaks.

> **Provenance, honestly.** This is reconstructed from the codebase, its inline
> comments, and the `docs/` folder — which is unusually complete because this
> project writes its reasoning down as it goes. It is **not** reconstructed from
> the original build conversations; those are not recoverable. So: the *what*
> and the *why* are faithful, sourced from the code. The chronology between
> phases 1–6 is inferred from the docs' own dates and cross-references and may
> be slightly off in ordering. Phase 7 onward is first-hand.

---

# Part I — What you are building

Three acts, built in this order, each useful alone.

| Act | Turns | Into |
|---|---|---|
| **1. The transcriber** | a link or a video file | a speaker-labeled transcript |
| **2. The library** | a pile of transcripts | a searchable research tool with tags |
| **3. The portal** | that research | a weekly filming plan a creator can act on |

The domain in the original is short-form social video (Instagram Reels, TikTok)
for creator management. **None of the architecture cares about that.** Act 1 is
a general media transcriber; Act 2 is a general tagged-corpus browser; Act 3 is
a general assignment-and-brief system. Swap the taxonomy and the lexicon and it
is a different product.

## The constitution

Five rules that produced almost every design decision. If you keep only one
thing from this document, keep these.

1. **It runs on your machine.** Transcription, diarization, OCR — all local. No
   API keys, no per-minute billing, no clips uploaded to a third party.
2. **Free unless proven otherwise.** Every dependency is a downloaded binary or
   a free tier. When a paid option appeared, the question was always "what does
   the free version cost us in quality?" and usually the answer was "nothing".
3. **Deterministic and rule-based over model-based**, for anything the user sees
   as a judgment. Tagging, briefs and matching are all lookup tables and scored
   keywords. *A wrong recommendation is then a number you can read and change,
   not a model you can only shrug at.* This is the single most load-bearing
   choice in the project.
4. **Say less rather than invent.** Every drafting rule returns null when it has
   nothing honest to say, and the UI renders nothing. A draft that is obviously
   a draft is fine; a draft that is confidently wrong is not.
5. **Measure before building, and let the measurement overturn the plan.** This
   happened repeatedly and is why several phases look nothing like their specs.

---

# Part II — Architecture

```
   ┌────────────────────────────┐         ┌──────────────────────────┐
   │  YOUR MAC (the worker)     │         │  VERCEL (the app)        │
   │                            │         │                          │
   │  yt-dlp    → fetch         │  claim  │  Next.js App Router      │
   │  ffmpeg    → audio/frames  │ ──────► │  queue, library, portal  │
   │  whisper.cpp → speech      │ complete│                          │
   │  sherpa-onnx → speakers    │ ◄────── │  ┌────────────────────┐  │
   │  Vision.framework → OCR    │         │  │ NEON (postgres)    │  │
   │                            │         │  └────────────────────┘  │
   │  media server :8788        │         │  ┌────────────────────┐  │
   │        │                   │         │  │ R2 (video for the  │  │
   │  cloudflared tunnel ───────┼─────────┼─►│ creator's phone)   │  │
   └────────────────────────────┘  signed │  └────────────────────┘  │
                                    URLs  └──────────────────────────┘
```

**Why this split.** The heavy, licence-encumbered, GPU-ish work is free on a Mac
you already own and impossible-to-free on a server. The *interface* needs to be
reachable from a phone. So the Mac does the work and pulls jobs; the app never
pushes. The Mac is behind NAT, so a Cloudflare tunnel publishes just the media
server, and every media URL is a short-lived HMAC signature.

**Why the videos live in two places.** Library playback streams from the Mac
through the tunnel (free, and the clip never leaves). But a creator opening her
plan on a phone can't depend on your laptop being awake, so *only* the videos
actually assigned to a plan get copied to R2. That is the entire reason R2 is in
the stack.

## Stack

- **Mac side:** Python 3.9+ stdlib (deliberately few packages), vendored
  binaries in `vendor/bin`, a `.venv`.
- **App side:** Next.js (App Router) + TypeScript on Vercel, Neon Postgres,
  Cloudflare R2, all free tier.
- **No ORM.** Raw parameterised SQL through a thin `sql` helper. Shared SQL
  fragments live in `src/lib/sql.ts` and `src/lib/hot.ts`.

---

# Part III — Build it

## Phase 0 — Toolchain

Goal: every binary and model present, no Homebrew, no sudo, no API key.

`setup.sh` is the whole story and is safe to re-run — it skips what exists.
Recreate it to fetch, into `vendor/`:

| Thing | Why |
|---|---|
| `yt-dlp` | fetches the post + its metadata (caption, handle, likes) |
| `ffmpeg` / `ffprobe` | audio extraction, frame sampling, duration |
| `cloudflared` | publishes the local media server (ships as a tarball) |
| `whisper.cpp` built with **Metal** | speech-to-text on the GPU |
| whisper models: `large-v3-turbo-q5_0`, `base-q5_1`, `silero-v5.1.2` (VAD) | |
| `sherpa-onnx` + `nemo_en_titanet_large.onnx` + pyannote segmentation | speaker diarization |

**Step 0.1** — `mkdir -p vendor/bin vendor/models inbox out`, then a `fetch()`
helper that curls to a destination only if it isn't already there.
**Step 0.2** — build whisper.cpp with Metal enabled (needs `cmake`; the original
vendors that too rather than assuming it).
**Step 0.3** — a `.venv`.
**Step 0.4 (phase 7 only)** — compile `src/ocr/ocr.swift` to `vendor/bin/ocr-text`
if `swiftc` exists; **skip with a notice if it doesn't**, and everything else
still works.

> **Your touch:** on Linux/Windows the Metal build and the Vision OCR both need
> replacing (CUDA/CPU whisper; PaddleOCR or Tesseract). Everything else is
> portable.

## Phase 1 — The local transcriber

Goal: `./bin/transcribe <url|file|folder>` produces a labeled transcript.

**The pipeline** (`src/pipeline.py`, ~209 lines — keep it this small; it is a
sequence of named stages and nothing else):

```
resolve → fetch → audio → [speech pass] → [visual pass] → diarize → merge → render → finalize
```

**Step 1.1 `src/media.py`** — resolve a source into a local file. Three kinds:
a URL, a local file, a folder. Strip tracking parameters so a share link and a
clean link are *the same post* (`source_key`). This dedup matters more than it
sounds; a bulk paste of thirty links is usually twenty posts.

**Step 1.2 `src/audio.py`** — ffmpeg to 16 kHz mono wav.

> **RULE: `-nostdin` on every single ffmpeg call.** ffmpeg reads stdin by
> default and will eat your caller's loop input. This silently truncated folder
> names during testing and took real time to find.

**Step 1.3 `src/asr.py`** — whisper.cpp with VAD. Emits segments with times.

**Step 1.4 `src/diarize.py` + `speakers.py` + `merge.py`** — segmentation +
speaker embeddings, then merge speaker turns onto ASR segments.

**Step 1.5 `src/render.py`** — write `transcript.json`, `plain.txt`,
`markdown.md`, `.srt` into `out/<slug>/`.

**Step 1.6 `src/cli.py` + `bin/transcribe`** — the CLI, `--batch`, `--list`.

**The measurement that shaped this phase.** The spec said to time a whisper pass
before designing around it, "because it might change the design." It did:
`large-v3-turbo` with Metal takes **~1 s** on a 6–30 s reel, against a fetch
that takes tens of seconds. So the pass is effectively free, and the design
flipped from *decide whether to transcribe* to **transcribe everything and let
the result tell you whether anyone spoke.**

That inversion is the reason `has_speech` exists as a *result* rather than a
*setting*, and it is the seed of Phase 7.

> **RULE: null ≠ false, for every "we looked" flag.** `has_speech` /
> `has_looked` null means *nothing has ever looked*. False means *looked, found
> nothing*. Conflate them and you re-process every silent video forever.

## Phase 2 — The drop-and-go local UI

Goal: `bin/serve` → `http://localhost:8765`, drag videos on, paste messy links.

`src/server.py` (~208 lines), stdlib HTTP only. **Binds 127.0.0.1 only.** Files
dropped are copied into `inbox/`. Jobs run one at a time with live status.

The useful subtlety: **dropped files need no login**, which is the reliable path
for saved Reels. Pasted links to private posts still need cookies
(`secrets/cookies.txt`) and no interface can work around that — so say so in the
UI rather than failing mysteriously.

## Phase 3 — The hosted queue

Goal: a Vercel app you can open on your phone and dump links into; the Mac
drains it.

**Step 3.1** — Next.js app, Neon database, `cloud/scripts/migrate.mjs` as the
single idempotent schema script (`create table if not exists`, `add column if
not exists` — additive forever, never destructive, safe to re-run).

**Step 3.2** — the worker protocol, four routes:

| Route | Direction |
|---|---|
| `POST /api/worker/claim` | Mac asks for a job |
| `POST /api/worker/progress` | stage updates |
| `POST /api/worker/complete` | transcript + metadata back |
| `POST /api/worker/fail` | error + attempt count |
| `POST /api/worker/ping` | heartbeat + **current media URL** |

All authenticated by a shared `worker_secret` bearer (`isWorker()`), separate
from the human `APP_PASSWORD` cookie gate (`Gate.tsx`, `/api/auth`).

**Step 3.3 — the media path.** `src/mediaserv.py` serves `/v/<folder>/{video,
poster,captions,download}` plus an **unauthenticated `/health`**. Every URL is
HMAC-signed with the worker secret and expires:

```ts
sign(scope, expires) = HMAC-SHA256(secret, `${scope}:${expires}`) → base64url
url = `${base}/v/${folder}/download?exp=${expires}&sig=${sig}`
```

**Step 3.4 — the tunnel** (`src/tunnel.py`). Two modes: a **named tunnel** if
config has `media_hostname` (stable forever, needs a Cloudflare zone), otherwise
a **quick tunnel** (free, no account, but the hostname is reissued on every
restart). Because the hostname moves, the worker *reports its live media URL on
every heartbeat* and the app signs against whatever is current —
`mediaBase()` reads it fresh per request and returns null if the heartbeat is
stale. See Phase 8; this is where the one real production outage came from.

## Phase 4 — The content library

Goal: a pile of transcripts becomes a research tool. *What does this creator
normally do, and which of it worked?*

**Three tag axes**, and the split is the whole design:

| Axis | Question | Max tags |
|---|---|---|
| `persona` | who is she | 2 |
| `format` | what shape is the video | 3 |
| `hook` | how do the first 3 seconds work | **1** |

**Step 4.1 `src/lib/taxonomy.json`** — the closed vocabulary. `isValidTag()`
filters every suggestion, so **a tag not in the taxonomy is silently dropped** —
a real trap when adding one.

**Step 4.2 `src/lib/lexicon.ts`** — keyword lists per tag. Whole-word matching
only: *without it `ink` fires on "thinking" and every talking video gets tagged
as a tattooed creator.*

**Step 4.3 `src/lib/autotag.ts`** — the scorer. The shape worth copying:

```ts
const MAX_PER_AXIS = { persona: 2, format: 3, hook: 1 }
const KEEP_ABOVE   = { persona: 0.6, format: 0.5, hook: 0.45 }
const HIT_BASE = 0.55, HIT_STEP = 0.08, HIT_CEIL = 0.85
```

*Persona is a claim about a person, so one stray word must not carry it — at 0.6
it takes two separate hits. A format or a hook can stand on a single unambiguous
phrase.* Suggestions are stored `origin='auto'` and **replaced wholesale** on
re-run; anything a human touched is `origin='human'` and is never overwritten.
`POST /api/retag?all=1` re-runs the lot.

Because `hook` keeps only **one** tag, a new hook rule must *out-score* the
incumbent, not tie it. This bites every time.

**Step 4.4 `src/lib/hot.ts`** — engagement scoring. `score = likes + 10 ×
comments`, compared to *that creator's own median*, not a global one. "Hot" =
beat your own median, recently, with enough history for the median to mean
anything. A creator with 400 followers and a creator with 400k are then
comparable.

**Step 4.5** — the UI: `LibraryTab`, `LibraryGrid`, `FilterBar`, `ItemView`,
`TagPicker`, `CreatorsTab`.

## Phase 5 — The model portal

Goal: research becomes something a creator can act on, on her phone.

- `models` — roster: persona/formats/hooks she does, `wont_do`, `weekly_target`,
  `filming_days`, `timezone`, `standing_rules`, and a unique `access_token`.
- `plans` — one per model per week (`week_of`, Monday-based), `status`
  draft→sent. **A draft is invisible to her until marked sent.**
- `plan_items` — one card: the reference video plus the brief fields.
- `plan_messages` — her replies, unread-styled until seen.

`/p/[token]` is the **only** Next.js page in the app; everything else is client
tabs behind the password gate. Her page needs no login — the token is the
credential, and it is revocable (`token_revoked_at`).

**Step 5.1 `src/lib/brief.ts`** — the drafter, and the best worked example of
rule 4 of the constitution. Lookup tables keyed by format tag (`SHAPE`,
`WARDROBE`, `CAMERA`, `TAKES`, `SOUND`, `CAPTION`, `LOCATION`) plus a hook-keyed
`OPENING` map. Resolution order for any field: **model override → format default
→ global default.** `captionFor()` returns null where the format says nothing,
*deliberately* — the obvious fallback is the reference's own opening line, and
handing her someone else's words as her caption is exactly the confidently-wrong
draft these rules exist to avoid.

**Step 5.2 — the contract that will bite you.** Briefs were rewritten twice
(prose blob → discrete fields). Both forms are still in the database. So
`isUntouchedDraft()` must recognise *every* form the drafter has ever written,
or "draft the empty ones" stops recognising its own output and **strands** every
card written under an older version — read as the human's work, never redrafted.

> **RULE: any new source of drafted text means a new recognised form.** Draft the
> item twice — once with the new input, once with it withheld — and accept both.
> Measured when on-screen text was added in phase 7: **67 references changed
> their draft, and all 67 would have stranded** without this.

## Phase 6 — Matching

Goal: which videos suit which model, and the reverse.

```
FIT = 3 × format-overlap
    + 2 × persona-overlap
    + 1 × hook-overlap
    + min(engagement / creator-median, 3)
MIN_FIT = 3
```

*Format weighs most: it is the thing she physically has to be able to shoot.
Persona is next — it is a claim about a person and is stable. Hook is a
tiebreaker, because almost any hook can be re-shot in any format.* The
outperformance cap stops one viral outlier outranking a video she can make.

Hard exclusions applied before scoring: her `wont_do` formats, and anything
already on a plan of hers.

**The explainability guard.** Every suggestion carries `matched` — the tags that
actually caused the score. `cardinality(matched) > 0` suppresses any suggestion
that cannot be explained. *A score with nothing behind it is not a
recommendation.* Note `matched` collects **format and persona only**, so a
hook-only item is suppressed — know this before concluding your matcher is dead.

`alsoOn` **warns** that another model already has this reel but deliberately does
not filter: two creators on one trend is sometimes exactly right, and that is
the operator's call to make with the fact in front of them.

Three surfaces consume it: the per-model suggestions rail, `modelsForJob` on a
library item, and `BatchWeek` — "build a week for everyone".

## Phase 7 — The visual pass

Goal: read text burned into the frame.

**The measurement that justified it.** The autotagger was 100% text-fed — every
input derived from whisper or the caption. The only visual artifact in the whole
system was a thumbnail nothing ever looked at. Measured on 170 folders: **50
(29%) return zero spoken words**, and every one of them took a dead branch that
assigned the same placeholder hook. So they were unrecommendable and their
briefs were near-empty. OCR over those 50: **44 (88%) carry on-screen text**, at
**0.8 s per video**.

**Step 7.1 `src/ocr/ocr.swift`** — Apple Vision, on-device, TSV out, never exits
non-zero.
**Step 7.2 `src/visual.py`** — sample 1 fps (cap 24 frames) at 720 px, dedup,
OCR, report.

Four things measured, worth not re-deriving:

1. **Pixel dedup barely fires.** In a talking-to-camera reel the person moves
   while the text card holds, so 8/8 frames survive. Kept because it's free and
   does collapse static clips, but it is not the mechanism that matters.
2. **The collapse that matters is on the text.** One held card came back as
   `big -`, `big`, `big >`, `big>»` — OCR jitter on one string. Merge on
   normalised prefix or `SequenceMatcher >= 0.85`, keep the longest variant with
   the first sighting's timestamp.
3. **You cannot just OCR the poster frame.** One reel read *"Why do you look so
   exhausted?"* then *"Meanwhile him last night:"* — the setup→punchline turn
   **is** the structure.
4. Store the beats **separately** (`on_screen_captions` jsonb) as well as joined
   (`on_screen_text`). The structure is what tells you a caption is a comparison
   rather than one statement.

> **RULE, load-bearing: never feed on-screen text to the persona axis. Hook and
> format only.** OCR returns watermarks, other people's handles, storefront
> overlays and outright non-words — `syd | ryd | eyd` came off a real reel.
> Persona needs two hits and is a claim about a person; screen text is the worst
> possible evidence for it. The verified safety property is that *a noise
> reading falls through to exactly the placeholder the system produced before*,
> so the garbage case cannot be worse than the status quo. Feeding persona
> breaks that property. The whole-word lexicon is itself the noise filter —
> non-words match nothing.

**Step 7.3 — backfill.** `POST /api/worker/unseen` returns rows where
`has_looked is null`, silent-first; `bin/relook` reads the copy already on disk
so **nothing is re-fetched** and a since-gated post stays safe.

**Step 7.4 — the comparison shape.** The commonest hook shape in this corpus was
misclassified: `how normal people cross their legs:` / `me:` came back
`question` because *how* is in the question lexicon. It is a **contrast**. Fixed
by reading the beats: *a caption of ≥2 beats whose closing beat is ≤6 words and
names a person is a comparison, whatever the first beat opened with.* Both
halves are load-bearing — length alone catches `Honorable mention:` off a
listicle; a person-word alone catches a closing sentence that happens to say
"I'm". Score it **above** the question branch, because only one hook survives.

**Result: 12 of 172 hook tags moved, all to contrast, and 0 spoken hooks
changed** — structural, because a transcript arrives as one string with no beats.

> **TRAP that cost real time: the 88% figure is about *text presence*, not *hook
> coverage*.** 48 of 54 silent videos (89%) produced text exactly as predicted,
> but only 24 of 54 gained a non-placeholder hook, because the remaining shapes
> (`me when …`, `X VS Y`) had no tag. Reading 88% as a hook target makes a
> correct result look like a failure.

## Phase 8 — Ops hardening

Goal: survive the tunnel.

**The outage.** Cloudflare withdrew a quick tunnel's hostname **without
`cloudflared` exiting**. The watcher only re-read the hostname after the process
died, so the cached URL went stale permanently while the worker heartbeated it
as healthy every few seconds. The app signed perfectly valid HMAC links to an
NXDOMAIN host and every download failed in the browser with *"Safari can't find
the server."* The safeguard in the ping route — *"if the tunnel died the worker
reports null"* — never fired, because the worker never learned it died.

**The fix:** a monitor thread that probes `/health` **over the public URL** —
deliberately not over localhost, which would have reported healthy throughout —
and on two consecutive failures clears the reported URL (so the heartbeat
finally reports null and the app stops handing out dead links) and terminates
cloudflared so a fresh hostname is issued.

> **Generalise this.** Any cached identifier that an external service can revoke
> without telling you needs a liveness check *along the path the user actually
> takes*. A health check that doesn't traverse the failing hop is decoration.

---

# Part IV — Data model

```
jobs ──1:1── transcripts ──*── tags
                  │
creators          └── (folder, has_speech, has_looked, on_screen_text,
                        on_screen_captions, thumbnail, like_count, …)
models ──*── plans ──*── plan_items ──*── plan_messages
   └── model_brief_defaults          └── (notes, wardrobe, camera, takes,
worker_pings (single row, id=1)            sound, hook, caption, location,
r2_trash                                   title, card_no, verdict, filmed_at)
```

Notes worth carrying:

- `jobs.source_key` is the deduped identity of a post.
- `worker_pings` is a **single row** (`id = 1`) upserted on every heartbeat, and
  `media_url` is **overwritten, not coalesced** — a remembered hostname would
  hand out links to nothing.
- `plan_items.card_no` counts on from the highest that model has *ever* had,
  across all weeks, so "video 7" keeps meaning the same card after a reorder.

---

# Part V — Rules, traps, and discipline

## Postgres / SQL

- **Regexes inside JS template literals eat their own backslashes** (`\d` → `d`).
  Keep SQL regex fragments in one file with doubled backslashes.
- **`btrim()` with no second argument strips spaces and nothing else.** A silent
  transcript holds a lone newline, survives `btrim`, and tests as non-empty — so
  a `nullif(x, '')` fallback never fires. This shipped a fix that changed 0 rows
  while looking completely correct. Name the characters: `btrim(x, E' \t\r\n')`.
- **Neon returns `count(*)` as a string.** Cast `::int` anywhere two counts add.
- Migrations are additive only. Never drop.

## CSS / UI

- **An undefined `var()` does not fall back — it invalidates the whole
  property.** Audit custom properties against your tokens file after any
  stylesheet edit.
- If two stylesheets both declare a dark `:root` and both load on a page, edit
  one and you must edit both.
- Watch for a class that is doing two jobs (a status badge *and* a button);
  scope new rules through a parent.

## Verification

**Look, don't reason.** This project shipped broken layouts twice by reasoning
about markup instead of screenshotting it. A headless-Chrome screenshotter
driven over CDP, with a cookie and optional click-steps, pays for itself. Check
**both themes**.

**Diff the whole corpus, old vs new.** For any change to a classifier: compile
the old and new modules side by side, run both over every row, and print the
change table. Then *split the diff by which code path each row takes* — not by
what the data looks like. Splitting on the wrong axis made three
screen-classified items look like spoken regressions.

**Verify without mutating.** To check a drafted card, create an *unsent* week,
screenshot, delete it. Never test on live sent data.

## Cost and process

- Write a `docs/NEXT-*.md` handoff whenever a session ends mid-arc. The ones in
  this repo are why phase 7 could be shipped by a session that had never seen it
  built. State what is *done*, what is *verified*, and what is *unstarted*.
- Keep a `docs/rollback/` with pre-change copies and a README mapping them,
  especially if the repo has no git. (This one doesn't. Fix that in yours.)

---

# Part VI — Where to put your own touch

Deliberately open:

- **The taxonomy and lexicon** are just data. Replace them and this becomes a
  tool for a different domain entirely.
- **The scoring weights** (`3/2/1`, `MIN_FIT`, the keep-thresholds) are constants
  in one file each, meant to be tuned against your own corpus.
- **The brief tables** encode one person's opinion about how to shoot video.
  Yours will differ; the *structure* (override → format default → global, and
  null when there's nothing honest to say) is the part worth keeping.
- **The matcher axes.** Three is not sacred. Add "length" or "location" as a
  fourth axis and the FIT formula extends naturally.
- **Swap the local stack** for an API if you don't care about rule 1 — the
  worker protocol doesn't know what's behind it.

Known-open, if you want somewhere to start:

- There is no hook tag for the `me when …` / POV-relatable shape, which is the
  single largest cluster of under-described items. Adding one is a taxonomy
  change that touches the filter UI, model matching, and the brief `OPENING` map.
- Notifications: nothing tells the operator that a creator declined a card or
  sent a message. Deliberately deferred until the roster is big enough to need
  it.
- Tests. There is a strong *measurement* discipline here and essentially no
  automated test suite. That trade was deliberate for a one-person tool and is
  the first thing to change for a team.

---

# Appendix — File map

**Mac (`src/`)** — `pipeline.py` (stages), `media.py` (resolve/fetch),
`audio.py`, `asr.py` (whisper), `diarize.py`/`speakers.py`/`merge.py`,
`visual.py` + `ocr/ocr.swift` (OCR), `render.py` (outputs), `worker.py` (queue
drain + heartbeat), `mediaserv.py` (signed media + `/health`), `tunnel.py`
(cloudflared + liveness), `server.py` (local UI), `r2.py`, `relook.py`,
`relisten.py`, `config.py`.

**App (`cloud/src/lib/`)** — `autotag.ts` + `lexicon.ts` + `taxonomy.json`
(tagging), `hot.ts` (engagement), `match.ts` (fit), `batch.ts` (whole-week
build), `brief.ts` (drafting), `models.ts` (roster/plans + `isUntouchedDraft`),
`plans.ts`, `sweep.ts`, `media.ts` (signing), `sql.ts` (shared fragments),
`r2.ts`/`r2queue.ts`, `auth.ts`, `decline.ts`, `timezones.ts`, `dates.ts`.

**Entry points (`bin/`)** — `transcribe`, `serve`, `worker`, `relook`,
`relisten`, `setup-cloud`.

**Config** — `config.json`: `cloud_url`, `worker_secret`, `cookies_file`,
`r2{...}`, optional `media_hostname`. App env: `DATABASE_URL`, `WORKER_SECRET`,
`APP_PASSWORD`, R2 credentials.

**Run the worker under a supervisor** (launchd/systemd) with keepalive — and
remember that if you do, killing it by PID makes the supervisor relaunch it,
so starting another by hand gives you two workers and two tunnels fighting over
the same heartbeat row.
