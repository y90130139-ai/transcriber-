# Model portal + content plans — handoff

Paste this whole file into a fresh Claude Code session with "Read it and build
it." Everything below is decided; nothing here needs re-litigating.

**This is purely additive.** Nothing that exists today changes behaviour. New
tables, new routes, new tab, one tab *label* change (called out below). Do not
refactor the library, the tagging, the scoring or the tunnel — they are built,
deployed and working.

## What exists today (read these first)
- `docs/CONTENT-LIBRARY.md` — the library that was built 2026-09-02: three tag
  axes, outperformance scoring, Cloudflare-tunnelled video. Read it before
  touching anything.
- `~/gosian` — **the reference implementation of the thing being asked for.**
  Prisma schema at `prisma/schema.prisma` (`Creator` / `Reference` /
  `Assignment`), console at `src/app/console/*`, share page at
  `src/app/p/[token]/`, check-off at `src/app/api/plan/[token]/filmed/`. Read
  its plan page and its creator console before designing anything. Do not import
  its code — different stack (Prisma) — but follow its shape.
- The visual reference Geno gave: `https://veil-plans.vercel.app/p/<token>`.

## The job
Add a **model portal**: our own models get a profile, and the library becomes the
source of their content plans.

Three flows:
1. **Roster** — add a model: profile photo, name, handle, persona, filming days,
   weekly target. A card with the photo, the name, and a small rectangular
   button that opens their plan.
2. **Assign from the library** — while reviewing a video in the item view, tag it
   to a model. That creates or appends to that model's current plan.
3. **Send the link** — each model has one stable, revocable URL,
   `/p/<access_token>`, that she opens on her phone. No login. She sees her
   numbered plan, plays each reference, and checks items off as filmed.

## Decided by Geno, 2026-09-02 — do not re-ask

- **Notes are auto-drafted, then edited.** An item must never land with an empty
  brief. See "Drafting the brief" below.
- **Plans are weekly**, like the reference: `Week of <date>`, a due date, a
  progress counter, and old weeks kept as history.
- **She sees all four**: the reference video playing inline, the Instagram link,
  a download of the file, and the transcript. Yes — the transcript goes to her.
- **She can write back per item**, not just tick a box: a Filmed toggle *and* a
  message box ("couldn't do this one", "need a different outfit").

## Naming trap — read this before writing a line
`transcriber.creators` and the current **Models tab** are the *Instagram accounts
we research*. They are source material, not our people. The models in this
build are **ours** and are a different entity with a different table.

Resolve it in the UI like this, and change nothing else:
- Existing tab label `Models` → **`Creators`** (matches `transcriber.creators`
  and `/api/creators`, which already use that word).
- New tab → **`Models`**.

That is the only change to anything that already exists. **Geno confirmed this
on 2026-09-02 — "creators is better". It is settled; do not raise it again.**

## Schema — new tables only

```sql
create table transcriber.models (
  id              text primary key,
  name            text not null,
  handle          text,
  photo_url       text,
  persona         text[] not null default '{}',   -- ids from taxonomy.json persona
  status          text not null default 'active', -- active | paused
  filming_days    int[]  not null default '{}',   -- 0=Sun .. 6=Sat
  weekly_target   integer not null default 21,
  timezone        text not null default 'America/New_York',
  standing_rules  text,                            -- "never show face", etc.
  notes           text,
  access_token    text unique not null,
  token_revoked_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table transcriber.plans (
  id         text primary key,
  model_id   text not null references transcriber.models(id) on delete cascade,
  week_of    date not null,
  due_date   date,
  title      text,
  intro      text,
  status     text not null default 'draft',       -- draft | sent
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plans_model_week_idx on transcriber.plans (model_id, week_of);

-- A plan item points at a library job, so it inherits the Instagram link, the
-- transcript, the tags, the engagement and the downloadable video for free.
-- Never copy those fields down.
create table transcriber.plan_items (
  id            text primary key,
  plan_id       text not null references transcriber.plans(id) on delete cascade,
  job_id        text not null references transcriber.jobs(id) on delete cascade,
  position      integer not null default 0,
  notes         text,          -- what to replicate: wardrobe, camera, angle
  editing_notes text,
  filmed_at     timestamptz,
  posted_at     timestamptz,
  post_url      text,
  -- What she says back about this item. Hers, not ours: never overwrite it
  -- from the console, and show it unread-styled until Geno has seen it.
  model_note    text,
  model_note_at timestamptz,
  seen_at       timestamptz,
  created_at    timestamptz not null default now()
);
create unique index plan_items_unique_idx on transcriber.plan_items (plan_id, job_id);
```

Add these to `cloud/scripts/migrate.mjs` (it is idempotent and safe to re-run).
Do not alter any existing table.

## The share page — `/p/[token]`

Follow the reference page's structure, in this order:

1. **Header** — "Your content plan", the model's name, her photo, `Week of
   <date>`, `Due <date>`, her filming days, and a progress counter `n/N` driven
   by `filmed_at`.
2. **How your plan works** — the short standing instructions. Keep the reference's
   five beats: watch the example, read the directions, make it yours, get the
   sound from Instagram, check it off.
3. **Numbered items** — `Video 1 … Video N` in `position` order. Each shows:
   - the reference video, playing inline from the tunnel;
   - **"Open in Instagram — use the sound or watch the original"** → `webpage_url`;
   - a download link for the file;
   - **the transcript** — collapsed by default, expandable. She gets the words.
     Use the speaker-labelled blocks, not the raw `plain` with its `[0:03]
     Speaker 1:` furniture (`spokenWords()` in `cloud/src/lib/autotag.ts` strips
     it; `preview()` in `cloud/src/lib/sql.ts` does it in SQL);
   - `notes` (wardrobe, camera, positioning, sound);
   - `editing_notes` when present;
   - a **Filmed** toggle that POSTs to `/api/plan/[token]/filmed`;
   - a **message box** writing `model_note` via `/api/plan/[token]/message`.
     Autosave on blur; show her that it saved. This is the only thing on the
     page she authors, so it must not lose what she typed.

Rules:
- **The token is the auth.** This route must sit outside the password gate —
  check the token, and reject when `token_revoked_at` is set. Do not require a
  session. Do not leak any other model's data.
- **Mint the signed video URLs server-side per request** with `linksFor()` from
  `cloud/src/lib/media.ts`. They expire in six hours, so they cannot be baked in.
- **Plan videos come from R2, not the tunnel.** See below. The tunnel stays the
  library's delivery path; it is not reliable enough to put in front of a client,
  because it dies whenever the Mac sleeps. If an item somehow has no R2 object
  yet, fall back to the Instagram link and never show a dead player.
- **Never blue.** The reference page uses blue underlined links; we do not. Bone
  ground, ink type, ember once, radius zero — `cloud/src/app/tokens.css`.
- Mobile-first. She will only ever open this on a phone.

## Plan videos live in Cloudflare R2

**Decided 2026-09-02.** The library keeps costing $0 by staying on the Mac behind
the tunnel. But a plan is client-facing: she may open it at 2am with the Mac
asleep, and a dead player is not acceptable. So **only videos that are on a plan**
get copied to R2. Nothing else is ever uploaded.

### What it costs

Checked against Cloudflare's pricing page on 2026-09-02. Free tier is **10
GB-month of storage, 1M Class A (write) operations, 10M Class B (read)
operations, and — the reason to use R2 at all — egress is free**. Paid rates
past that are $0.015/GB-month, $4.50/M Class A, $0.36/M Class B.

Measured: 43 stored videos = 399 MB, so **~9.3 MB each**. A 26-video week is
~240 MB, so the free tier holds roughly **40 model-weeks** outright.

**Therefore: add a retention rule and it is free forever.** Delete a plan's R2
objects when its week closes or the plan is deleted. Three active models at a
time is ~720 MB — permanently inside the free tier. Without retention, three
models for a year is ~37 GB, which is about **$0.40/month**. Either way this is
not a real cost. Reads are trivial: a model watching 26 videos is 26 Class B ops
against a 10M allowance.

Geno will need a Cloudflare account with R2 enabled. Whether that requires a card
on file is not stated in the docs — he will find out at signup; do not promise
either way.

### How the bytes get there

**The worker uploads, not the app.** The Mac already has the file, and routing
10 MB through a Vercel function is exactly the cap that forced phone uploads to
go browser-direct to Blob in the first place. So:

1. Adding an item to a plan marks it as needing upload.
2. The worker polls for those alongside its job claim, `PUT`s the file to R2, and
   records the object key.
3. The share page mints a **presigned GET** for each item, server-side, per
   request.

**Presign; do not make the bucket public.** A public bucket needs either the
rate-limited `r2.dev` subdomain or a custom domain, and a custom domain needs a
zone on Cloudflare — `sinauraco.com` is on Vercel nameservers and its apex must
not move. Presigned S3 URLs need neither.

- On the Mac, `curl --aws-sigv4` handles the signing (verified: curl 8.7.1 ships
  with it) — no boto3, keeping the project's no-dependencies rule.
- In the app, presign with a small S3 signer. Do not pull in the whole AWS SDK
  for one signed GET.
- Credentials go in `config.json` for the worker — it is already gitignored and
  already holds `worker_secret` — and in Vercel env for the app:
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  Push them to Vercel **before** running any `vercel` command that triggers an
  implicit `env pull`.

Schema for it, on `plan_items`:

```sql
r2_key       text,          -- object key once uploaded
r2_bytes     bigint,
uploaded_at  timestamptz    -- null means "worker still owes us this one"
```

Show upload state in the plan editor. Geno must be able to see, before he sends
a link, that every item is actually available to her.

## The console side

- **Models tab** — a grid of profile cards: photo, name, persona chips, `n` items
  this week, and a small rectangular button that opens her plan. Reuse the
  existing `.model` / `.models` CSS in `cloud/src/app/library.css`; it is already
  the right shape.
- **Add / edit a model** — a sheet like `CreatorSheet.tsx`. Photo upload goes
  through **Vercel Blob, which is already wired**: copy the client `upload()`
  call in `QueueTab.tsx` and the handler at `src/app/api/uploads/route.ts`
  (store `transcriber-uploads`, `BLOB_READ_WRITE_TOKEN` already in the env).
  Do not build a second storage path.
- **Assign from the library** — add one control to `ItemView.tsx`: pick a model,
  pick a week, it upserts the plan and appends a `plan_items` row. Additive; do
  not disturb the existing tag chips, copy or download controls.
  Bulk assign from the Library multi-select is a nice-to-have, not required.
- **Plan editor** — reorder items, write `notes` / `editing_notes`, set
  `due_date`, mark `sent`. Copy the share link to the clipboard.

### Drafting the brief

Notes are **auto-drafted on assignment and then edited by hand** — Geno chose
this over writing every one from scratch. Build it the way the tagger was built:
deterministic, rule-based, **no API key**, in `cloud/src/lib/brief.ts`, so a
wrong draft is a rule you can read and fix.

Draft from what the library already knows about the item:
- its `format` and `hook` tags → the shape of the video and how it opens;
- the first line of the transcript → the actual hook to adapt;
- `duration_sec` → roughly how long hers should run;
- `speaker_count` → whether she needs a second person;
- the model's `standing_rules` → e.g. never contradict "never show face".

Keep drafts short and imperative, the register of the reference page: what to
wear, where to stand, what the camera does, where the sound comes from. A draft
that is obviously a draft is fine — Geno edits before sending. A draft that is
confidently wrong is not, so say less rather than inventing detail the library
does not support.

## Routes to add
```
/p/[token]                        the model's plan (no session)
/api/plan/[token]                 GET  the plan as she sees it
/api/plan/[token]/filmed          POST toggle one item filmed
/api/plan/[token]/message         POST save her note on one item
/api/models                       GET list, POST create
/api/models/[id]                  GET, PUT, DELETE; PUT rotates/revokes the token
/api/plans                        POST create-or-get a model's plan for a week
/api/plans/[id]                   GET, PUT (title/intro/due/status)
/api/plans/[id]/items             POST add, PUT reorder/edit, DELETE remove
```

## Traps (do not rediscover)
- **Regexes inside JS template literals eat their backslashes** (`\d` → `d`).
  This silently corrupted a Postgres `regexp_replace` into a character class that
  deleted letters. SQL fragments carrying regexes live in `cloud/src/lib/sql.ts`
  with doubled backslashes.
- **`vercel deploy --prod` from `cloud/` is the deploy.** The URL it prints
  (`transcriber-<hash>-…`) is that deployment's permanent address, **not** a new
  project. The aliases are `transcriber-ten-zeta.vercel.app` and
  `transcriber-sinauraco-s-projects.vercel.app`; the worker points at the latter.
  There is one `transcriber` project — do not create another.
- Several `vercel` subcommands run an implicit `env pull` that overwrites
  `cloud/.env.local`. Back it up before running them.
- Node scripts cannot resolve `cloud/node_modules` from `/tmp`. Run them from
  `cloud/`.
- A quick trycloudflare hostname does not resolve for its first 1–2 minutes.
  That is DNS propagation, not a broken tunnel.
- `cloud/scripts/status.mjs` has `limit 12` — a display cap, not a count.
- The launchd worker is **enabled and running**. Leave it that way. If you must
  stop it: `launchctl bootout` then `disable`; `bootstrap` alone will not bring
  it back after a `disable`.

## State at handoff (2026-09-02)
36 transcribed and tagged, 3 permanently failed (audience-restricted). Library,
tagging, scoring and tunnelled video are live in production. Worker running,
one cloudflared tunnel, heartbeating its media URL to the deployed app.
