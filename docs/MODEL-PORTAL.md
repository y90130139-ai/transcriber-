# The model portal

The transcriber's third act. The first turns a link into words, the second turns
a pile of words into a research tool, and this turns the research into something
a person can actually film this week.

Our models get a profile, the library becomes the source of their weekly plans,
and each of them gets one link she opens on her phone.

## The naming trap, resolved

`transcriber.creators` and the **Creators** tab are the Instagram accounts we
*research*. They are source material, not our people.

`transcriber.models` and the **Models** tab are **ours**. Different entity,
different table, different tab. The old tab was called Models and is now called
Creators; nothing else about it changed.

## The three flows

1. **Roster** — Models tab. A card per model: photo, name, persona chips, how
   many items are on this week and how many are filmed, and a small rectangular
   button that opens her plan. An ember badge counts anything she has written
   back that has not been read.
2. **Assign** — open any video in the Library and use *Put it on a plan*: pick
   her, pick the week, tap Add. The plan is created if it does not exist, the
   item is appended, and its brief is **drafted on the way in**.
3. **Send** — each model has one stable, revocable URL, `/p/<access_token>`.
   No login. She sees her numbered plan, plays each reference, ticks items off
   as filmed, and can write back per item.

## Weeks

Plans are weekly and a week is always its Monday. Every plan has a due date
(default: the Sunday), a progress counter driven by `filmed_at`, and old weeks
are kept as history in the week rail.

A plan is `draft` until it is marked `sent`. **A draft is invisible to her** —
that is the whole point of the status. She sees this week's sent plan, or the
nearest sent week within seven days ahead or fourteen behind, so a plan sent on
Friday for next week opens to something on Saturday.

## The token is the auth

`/p/[token]` sits outside the password gate. Unknown, malformed and revoked
tokens all return **404, never 403** — a 403 would confirm there is something
behind the URL.

Every read her phone can trigger goes through `cloud/src/lib/plans.ts` and
nowhere else. Each query is filtered by the token's own model at the database
layer: no endpoint takes a model id from the request, and no query there can
widen to a second model under any parameter. `models.notes` is internal and is
never selected — not even as unrendered payload in a server component's flight
data.

Rotating the link mints a new token and un-revokes; revoking stamps
`token_revoked_at` and the old URL dies immediately. Both live in the model
sheet.

## What she gets per item

The reference video playing inline, **Open in Instagram** for the sound and the
original, a download link, the transcript (collapsed, speaker-labelled), the
direction, editing notes when present, a Filmed toggle, and a message box.

The message box is the only thing on the page she authors, so it autosaves on
blur and says so. What she writes lands in `plan_items.model_note` and is
**hers**: the console can read it and mark it read, and has no way to overwrite
it. Editing a note clears `seen_at`, so it surfaces as unread again rather than
sitting silently under a tick.

## Drafting the brief

An item must never land with an empty brief — an empty brief is a plan that
quietly does not get filmed. So assignment drafts one and Geno edits it before
sending.

Built the way the tagger was built: deterministic, rule-based, **no API key**,
in `cloud/src/lib/brief.ts`. A wrong draft is then a rule you can read and fix.

It draws on what the library already holds:

| Signal | What it becomes |
|---|---|
| `format` tags | the shape of the video |
| `hook` tags | how the first three seconds work |
| first line of the transcript | the actual line to adapt, quoted |
| `duration_sec` | roughly how long hers should run |
| `speaker_count` | whether she needs a second person |
| `standing_rules` | never contradicted — a no-face rule rewrites the opening |

The rules say less rather than inventing detail the library does not support.
A draft that is obviously a draft is fine. A draft that is confidently wrong is
not.

## Plan videos live in Cloudflare R2

The library keeps costing $0 by staying on the Mac behind the tunnel. A plan is
different: she may open it at 2am with the Mac asleep, and a dead player is not
something to hand a client. So **only videos that are on a plan** are copied to
R2. Nothing else is ever uploaded.

### The worker uploads, not the app

The Mac already has the file, and routing ten megabytes through a Vercel
function is exactly the cap that forced phone uploads to go browser-direct to
Blob in the first place.

```
add to a plan ──> app lists it as owed
worker polls  ──> /api/worker/claim returns { jobs, uploads, expired, trash }
worker PUTs   ──> curl --aws-sigv4 ──> R2
worker reports──> /api/worker/r2
her phone     ──> app mints a presigned GET per request (6 hours)
```

Presigned, never public. A public bucket needs either the rate-limited `r2.dev`
subdomain or a custom domain, and a custom domain needs a zone on Cloudflare —
`sinauraco.com` is on Vercel nameservers and its apex must not move.

The signing is hand-rolled in `cloud/src/lib/r2.ts` rather than pulled from the
AWS SDK; it is checked against AWS's own published presigned-GET test vector.
On the Mac it is `curl --aws-sigv4`, with the credentials fed in on stdin as a
curl config file so they never appear in `ps`.

### Retention is what keeps it free

Free tier is 10 GB-month of storage, 1M writes, 10M reads, and **free egress**.
Measured on the stored corpus, a video is ~9.3 MB, so a 26-video week is ~240 MB
and the free tier holds roughly 40 model-weeks outright.

`R2_RETENTION_DAYS = 21` in `cloud/src/lib/r2queue.ts`. A plan's objects are
reclaimed once its week is that far behind; three active models at a time is
then about 720 MB, permanently inside the free tier. Objects whose row is
already gone — a deleted plan, item, model, or library job — are collected in
`transcriber.r2_trash` and reclaimed on the Mac's next poll, because only the
Mac holds credentials that can delete them.

A reclaimed item is stamped `r2_purged_at` rather than merely blanked. Without
the stamp the very next poll would queue it for re-upload and retention would
loop forever.

### Setting it up

R2 is optional, and its absence is a normal state rather than an error: the plan
editor shows the items as still waiting, and her page falls back to the
Instagram link rather than showing a player that cannot load.

1. Turn on R2 in the Cloudflare dashboard and make a bucket.
2. Make an R2 API token (Object Read & Write) and note the account id, access
   key id and secret.
3. On the Mac, add to `config.json` (already gitignored, already holds
   `worker_secret`):

   ```json
   "r2": {
     "account_id": "…",
     "access_key_id": "…",
     "secret_access_key": "…",
     "bucket": "transcriber-plans"
   }
   ```

4. In Vercel, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   and `R2_BUCKET`. **Push them before running any `vercel` command that
   triggers an implicit `env pull`**, which overwrites `cloud/.env.local`.
5. Restart the worker.

## Schema

```
transcriber.models      our people: persona[], filming_days[], weekly_target,
                        standing_rules, notes (internal), access_token
transcriber.plans       one per (model, week_of); draft | sent
transcriber.plan_items  points at a jobs row, so the Instagram link, transcript,
                        tags, engagement and video are inherited, never copied
                        + notes, editing_notes, filmed_at, model_note
                        + r2_key, r2_bytes, uploaded_at, r2_purged_at
transcriber.r2_trash    keys whose row is gone, waiting on the Mac
```

```bash
cd cloud && node scripts/migrate.mjs    # idempotent; adds only new tables
```

## Routes

```
/p/[token]                  her plan (no session)
/api/plan/[token]           GET  the plan as she sees it
/api/plan/[token]/filmed    POST toggle one item filmed
/api/plan/[token]/message   POST save her note on one item
/api/models                 GET list, POST create
/api/models/[id]            GET, PUT (also rotates/revokes the token), DELETE
/api/plans                  POST create-or-get a week, optionally appending an item
/api/plans/[id]             GET, PUT, DELETE
/api/plans/[id]/items       POST add, PUT reorder/edit, DELETE remove
/api/uploads/photo          Blob token for a profile photo — queues no job
/api/worker/r2              the Mac reports what it moved and reclaimed
```

## Traps

- **Cast your parameters.** Postgres cannot infer the type of a parameter that
  only ever appears in `case when $2 is null`, and the driver reports it as a
  flat 500. The write routes cast every one of those explicitly.
- Dates cross the wire as `YYYY-MM-DD` strings, never as `Date` objects — the
  columns are `date` with no time and no zone, and reads use
  `to_char(…, 'YYYY-MM-DD')`. Turning one into a JS Date is how a plan ends up a
  day early in Hawaii.
- The rate limiter in `cloud/src/lib/ratelimit.ts` is per-instance and
  best-effort by design. A database round trip on every tap of a Filmed toggle
  would cost more than the abuse it prevents.
- A bogus R2 account id fails the TLS handshake rather than returning 403,
  because Cloudflare has no certificate for a subdomain that does not exist.
  That is a wrong account id, not a broken curl.
