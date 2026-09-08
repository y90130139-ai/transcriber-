# Model tags + recommendations — handoff

Paste this whole file into a fresh Claude Code session with "Read it and build
it." Everything below is decided; nothing here needs re-litigating.

**This is purely additive.** Three new columns on one existing table, one new
lib file, two new routes, and additions to three components. Nothing that exists
today changes behaviour. Do not refactor the library, the tagging, the scoring,
the tunnel, the plans or R2 — they are built, deployed and working.

## What exists today (read these first)
- `docs/MODEL-PORTAL.md` — models, plans, the share link, R2. Built 2026-09-02.
- `docs/CONTENT-LIBRARY.md` — the three tag axes, outperformance scoring.
- `cloud/src/lib/taxonomy.json` — the vocabulary. **Both sides use it already.**
  A video is tagged persona / format / hook; a model already carries `persona`.

## The job

Geno, 2026-09-02:

> include possible tags from the Creators tab — look through the library and say
> this model does talking heads, skits, text overlays, etc, all of those video
> concepts, and click on the ones she does so it's easier for me and the system
> to identify which videos go where. We can also use it as a recommendation of
> like *ohh we should add this video to this model and another model* —
> providing recommendations based on the models we throw in there. Obviously we
> should be able to add as many tags as necessary.

So: **tag the model in the same vocabulary the library already uses, then let
the two sides find each other.**

Two directions, both required:

1. **Video → models.** Looking at one library item, see which of our models it
   suits, and add it to one or several without leaving the item view.
2. **Model → videos.** Looking at one model's week, see the library items that
   fit her and are not already on a plan, ranked, with one-tap add.

## Schema — three columns, no new tables

```sql
alter table transcriber.models
  add column if not exists formats text[] not null default '{}',
  add column if not exists hooks   text[] not null default '{}',
  -- Formats she will not do. A hard exclusion, not a low score: recommending
  -- gym content to someone who has said no is worse than recommending nothing.
  add column if not exists wont_do text[] not null default '{}';
```

Add to `cloud/scripts/migrate.mjs` (idempotent, safe to re-run). `persona` is
already there — do not add it again, and do not touch any other table.

**No cap on how many tags a model carries.** The autotagger caps suggestions per
axis (`MAX_PER_AXIS` in `autotag.ts`) because a guess about one video should be
narrow. A model's own list is a human statement about a person and is uncapped —
Geno asked for this explicitly.

## Matching — `cloud/src/lib/match.ts`

Build it the way `hot.ts` and `brief.ts` were built: **deterministic,
rule-based, no API key, every constant in one file** so a bad recommendation is
a number you can read and change.

```
fit = 3 × (format tags in common)
    + 2 × (persona tags in common)
    + 1 × (hook tags in common)
    + min(outperformance, 3)          // a proven video is worth surfacing
```

- **Format is weighted highest** because it is the thing she physically has to
  be able to shoot. Persona is next: it is a claim about the creator and is
  stable. Hook is a tiebreaker — almost any hook can be re-shot in any format.
- **Outperformance is a bonus, never a gate.** It caps at 3 so one viral outlier
  cannot outrank actual fit. Items with no engagement data score 0 here rather
  than being excluded.
- **Hard exclusions, applied before scoring:**
  - any of the item's `format` tags appears in her `wont_do`;
  - the item is already on any plan of hers (`plan_items` joined through
    `plans.model_id`) — recommending what she already has is noise;
  - `models.status = 'paused'` for the video → models direction.
- **A model with no tags matches nothing.** Do not fall back to "show
  everything" — an untagged model should read as untagged, not as omnivorous.
  Say so in the UI instead.
- Ties break on outperformance, then newest `upload_date`.
- Export a `MIN_FIT` floor (start at **3** — one format match, or a persona
  match plus a hook) so weak matches are absent rather than listed.

Reuse `SCORING_CTE` / `SCORING_COLUMNS` / `SCORING_JOIN` from `hot.ts` for the
outperformance term; do not recompute it.

## Routes

```
GET /api/models?job=<id>            each model gains `fit` and `matched`
GET /api/models/[id]/suggestions    ranked library items that fit her
```

- `?job=` on the existing `/api/models` is an addition to that route, not a new
  one. Without the parameter its response must be **byte-identical** to today's
   — the roster grid depends on it.
- `matched` should name the tags that caused the score (`['talking-head',
  'girl-next-door']`), because a recommendation you cannot explain is one Geno
  will stop trusting.
- `suggestions` takes an optional `?limit=` (default 12, max 40). It must not
  take a week — what is already assigned is excluded across *all* her plans, not
  just the open one.

## The console

**1. Model sheet** (`cloud/src/components/roster/ModelSheet.tsx`)

It already has a persona picker built on `.picker-grid` / `.picker-option`.
Add three more of exactly the same shape, in this order:

| Section | Vocabulary | Note |
|---|---|---|
| Persona | `taxonomy.persona` | already built, leave as is |
| Formats she does | `taxonomy.format` | the main one — this is what Geno asked for |
| Hooks that work for her | `taxonomy.hook` | collapsed by default; it is a tiebreaker |
| Won't do | `taxonomy.format` | chips in `--sc-critical`, not ember |

Do not invent a fourth vocabulary. Do not let a format sit in both *does* and
*won't do* — selecting it in one removes it from the other.

**2. Item view** (`cloud/src/components/roster/AssignBar.tsx`)

Above the existing model/week/Add row, list the models this video fits as
tappable chips: `MAYA · talking head, girl next door`. Tapping one selects her
in the dropdown so Add is the next tap. This is the *"we should add this video
to this model and another model"* flow, so **adding to a second model must not
clear the first** — after a successful add, mark that chip as done and leave the
bar open.

Keep the existing dropdown. The chips are a shortcut, not a replacement: an
untagged model must still be reachable.

**3. Plan editor** (`cloud/src/components/roster/PlanEditor.tsx`)

Under the item list, a **Suggested for her** section: thumb, handle,
outperformance, the matched tags as small chips, and one **Add** button per row
that appends to the open week. Refresh the list after each add so the row
leaves. If she has no tags, show one line pointing at the model sheet rather
than an empty grid.

## Files to touch

```
cloud/scripts/migrate.mjs                 three alter-table columns
cloud/src/lib/match.ts                    NEW — weights, exclusions, the query
cloud/src/lib/models.ts                   MODEL_COLUMNS + readModelInput
cloud/src/components/roster/types.ts      Model gains formats/hooks/wont_do
cloud/src/components/roster/ModelSheet.tsx      three pickers
cloud/src/components/roster/AssignBar.tsx       fit chips
cloud/src/components/roster/PlanEditor.tsx      suggested-for-her section
cloud/src/app/api/models/route.ts               ?job= support
cloud/src/app/api/models/[id]/suggestions/route.ts   NEW
cloud/src/app/api/models/[id]/route.ts          PUT writes the three arrays
```

## Traps (do not rediscover — these cost real time)

- **`/api/models/[id]` PUT uses numbered parameters** (`$1 … $14`) including
  `case when $12 then $13 …` for the token. Adding three arrays shifts that
  numbering. Re-count every placeholder, and test rotate **and** revoke
  afterwards — a mis-numbered `$` there silently rotates a live model's link.
- **Cast ambiguous parameters.** Postgres cannot infer the type of a parameter
  that appears only in something like `case when $2 is null`, and the driver
  reports it as a flat 500 (SQLSTATE 42P08). The plan write routes already cast
  every one; do the same in anything new.
- **Array overlap in Postgres is `&&`**, and both sides must be `text[]`:
  `m.formats && array_agg(g.tag)` needs the aggregate cast. Counting the overlap
  is easiest as `cardinality(array(select unnest(a) intersect select unnest(b)))`.
- Next.js App Router **route files may only export HTTP methods**. Shared
  helpers go in `cloud/src/lib/`, never in a `route.ts`.
- Regexes inside JS template literals eat their backslashes (`\d` → `d`). SQL
  fragments carrying regexes live in `cloud/src/lib/sql.ts` with doubled ones.
- `next dev` may not hydrate under headless Chrome here (the HMR websocket is
  blocked). Test interactivity against `npm run build && npm start`, and use CDP
  `Emulation.setDeviceMetricsOverride` for mobile screenshots — `--window-size`
  alone renders a desktop viewport and crops, which looks like overflow that is
  not there.
- **`vercel deploy --prod` from `cloud/` is the deploy.** The URL it prints is
  that deployment's permanent address, **not a new project**. One `transcriber`
  project, two aliases; the worker points at
  `transcriber-sinauraco-s-projects.vercel.app`.
- Several `vercel` subcommands run an implicit `env pull` that overwrites
  `cloud/.env.local`. Back it up first.
- Node scripts cannot resolve `cloud/node_modules` from `/tmp`. Run from `cloud/`.

## Worth doing if it is cheap, not required

- **Seed her tags from what she has already been assigned** — a button in the
  model sheet that reads the tags of everything on her past plans and pre-ticks
  them. Turns the first setup from twenty taps into one.
- **Bulk assign** from the Library multi-select: "Add 6 to Maya's week". The
  select bar and `appendItems()` already exist; it is a button and a model
  picker.
- Let `brief.ts` mention when an item's format is one she has never done, so the
  draft says "this is new for you" rather than pretending it is routine.

## State at handoff (2026-09-02)

Library, tagging, scoring, tunnelled video, the model portal, plans, the share
page and the R2 pipeline are all live in production. 36 transcribed and tagged,
3 permanently failed. R2 itself is **not configured yet** — plans fall back to
the Instagram link, which is a supported state, not a bug. The launchd worker is
enabled and running; leave it that way.
