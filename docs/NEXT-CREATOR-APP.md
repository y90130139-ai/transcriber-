# The model app — her plan as a native iOS app (Expo)

Handoff brief. Paste this whole file into a fresh Claude Code session with
"Read it and build it." Everything below is decided unless it says OPEN.
Re-litigating decided items is how the portal build lost a day; read
`docs/MODEL-PORTAL.md` and `docs/PORTAL-V2.md` before this one — this app is
their sequel, not their replacement.

**Date:** 2026-10-10, Geno's ask: "get the creator side into an Expo iOS app —
send them creator plans from the dashboard, and they can film or upload
whatever they want. Read-only mode is fine to start."

## The naming trap, again

In this repo, **creators** (`transcriber.creators`) are the Instagram accounts
we *research*. The people this app is for are **models** (`transcriber.models`)
— ours. The brief may say "creator app" in conversation; every table, route,
and comment we write uses **model**, exactly as the portal does. Do not
introduce a second vocabulary.

## What this is, in one paragraph

The plan she opens today is a web page (`/p/<token>`), mobile-first, behind a
revocable token instead of a login. It already does more than most apps: it
plays the reference, prints the brief, takes accept/decline, carries a
two-way thread per card, ticks filmed, and has a swipe deck. It is also a
PWA — she can install it — but Apple gives her no icon in the dock worth the
name, no camera inside the plan, no push when a week lands, and no place to
put the video she just shot except her own camera roll and a Google Drive
folder. **This build turns that page into a real iOS app**: plans arrive as
notifications from the dashboard, the brief overlays the viewfinder, the take
uploads straight back, and the console sees it land. The web portal stays up
forever as the fallback — the token link must never die.

## Why an app at all — the gaps this closes, from our own deferred list

`docs/PORTAL-V2.md` ends with "Still deferred": *notifications in both
directions*, *in-portal upload*, Spanish, roles and an audit log. Two of those
four land here. Today the only way we reach her is a Telegram group message
(`models.telegram_chat_id`, the bot's outbox) and the only way footage reaches
us is `models.drive_url` — a Google Drive folder she has to leave the app to
find. The app closes both loops:

| Gap today | What the app adds |
|---|---|
| `sent` plan → bot messages the group, link gets buried | APNs push: "Your week of X is ready — 14 videos" → opens the plan |
| Operator replies land in the plan's thread, unseen for days | Push on every operator message |
| No nudge when filming slips | Reuse the windows in `lib/reminders.ts`; push instead of Telegram |
| Footage: film → leave app → camera roll → Drive → hope | Film in-app from a card, or upload from the library; it lands attached to the card |
| Discover deck is a web page she has to remember | In the app, next to her week |

Apple also reads this better than a wrapper: camera and push are real native
value (guideline 4.2), and **read-only mode gives us a safe first TestFlight**.

## Hard rules — do not break any of these

1. **Additive only.** `/p/<token>` keeps working, byte-for-byte behaviour.
   The app consumes the same API surface and the same `plans.ts` boundary.
2. **The token is the auth.** No passwords, no email login, no accounts. A
   paired device is the token's model, at the database layer, forever. Unknown
   and revoked → 404, never 403.
3. **Nothing reaches a creator without a human tap.** Draft plans are
   invisible; push only fires for `status = 'sent'`. No auto-send anywhere.
4. **Video policy is unchanged.** Reference video lives on the Mac / R2 and
   never moves. Her *uploads* are new bytes going the other way — they go to
   Vercel Blob (already wired), never into the library.
5. **`models.notes` is internal.** Never selected, never in any app payload.
6. **Plain-language copy.** She is not technical. No "sync", no "session
   expired" — "we couldn't reach the studio, trying again".
7. **No OnlyFans/adult links in the iOS binary.** Apple 1.1.4/1.2 territory.
   The app is the planning + filming surface: IG/TikTok references, briefs,
   uploads. OF audits, earnings, anything adult stays console/web-side.
8. Squares and bone/ink/ember: the app uses the plan surface's own system
   (rounded 14/10, `tokens.css`, `plan.css` dark block, `motion.css` springs).
   It must feel like her page, because it is her page.

## Ground truth to read before writing code

- `docs/MODEL-PORTAL.md` — what `/p/[token]` renders, item by item. **The app
  is a port of this page; the page is the spec.**
- `docs/PORTAL-V2.md` — every phase decision (accept/decline, threads, dark
  mode, structured briefs, locations, rating, made-it, delivery block) and the
  traps that came with them.
- `cloud/src/lib/plans.ts` — **the isolation boundary.** Every read her phone
  can trigger goes through this file and nowhere else. The app gets the same
  `loadPlan` JSON the page gets. Do not copy queries into app routes; do not
  add a query that takes a model id from the request.
- `cloud/src/app/p/[token]/` — plan, discover, survey pages; the manifest
  route (she can already install it; the app supersedes it, the route stays).
- `cloud/src/app/api/plan/[token]/` — the existing writes: `filmed`,
  `verdict`, `message`, `rate`, `made`, `survey`, `style`, `discover`,
  `run`, `scorecard`, `photo`, `thumb`.
- `cloud/src/app/(console)/models` + `PlanEditor` + `docs/MODEL-PORTAL.md` §
  "Send" — the dashboard side that sends plans. Sending already works; the
  app must not grow a second sender.
- `cloud/scripts/migrate.mjs` — additive, re-runnable migrations, tagged-
  template SQL, no ORM.
- `cloud/src/app/tokens.css`, `plan.css`, `motion.css`, `globals.css` — the
  visual system, including the two byte-identical dark `:root` blocks.
- `REVIEW-BRIEF.md` §8 "Keep it like ours" — the house rules.
- `cloud/src/components/plan/PlanView.tsx` + `PlanItemCard.tsx` — the actual
  rendering, and the **preview discipline** to copy: in preview mode every
  mutation returns before its fetch, verified with the network recorded. The
  app's read-only mode is the same trick, wholesale.

## Decisions taken (Geno, 2026-10-10) — do not re-ask

### Auth: pair the device, not the person

There is no login to give her, and inventing one (email + code) adds an
account system, an audit log, and Apple-said-no surfaces we don't need.

- Her existing link is the pairing credential: the app opens (universal link
  or `gosian://pair?t=<token>` as the fallback), exchanges it once via
  `POST /api/app/pair`, and stores a **device credential** in SecureStore.
- Device credential: 32+ random chars, one per install, tied to one
  `model_id`, revocable per device from her sheet, and **revoked the moment
  `models.token_revoked_at` is stamped** — rotating her link kills every
  paired phone. That is the point of rotating it.
- Every app-facing route accepts the device credential as `Bearer` and
  resolves to the same model `plans.ts` already resolves; a device never
  widens past its own model. 404, never 403.
- Universal links need the AASA file served from the domain in the app's
  Associated Domains. `sinauraco.com`'s **apex must not move** (it is on
  Vercel nameservers) — use a subdomain (`go.sinauraco.com`) and serve
  `.well-known/apple-app-site-association` from the Next app. Until that's
  live, the custom scheme fallback carries TestFlight.

### READ-ONLY is a first-class mode

One switch — `APP_MODE` remote config, defaulting `read-only` for the first
TestFlight (Geno: "read-only mode is fine to start"). In read-only:

- Every screen renders fully: header, progress, delivery block, all cards,
  player, transcript, thread history, deck (view only), her run stats.
- **Every mutation returns before its fetch** — filmed, verdict, message,
  rating, made-it, survey, style, pairing writes nothing outside its device
  row. Verified the same way the console preview was: drive every control
  with the network recorded, prove zero mutating requests.
- The flag flips per-phase, from the console, not a redeploy.

### What "send" means in the app

The dashboard does not get an app-side twin. Sending stays: console marks the
week `sent` → row lands in the bot outbox for the Telegram group (unchanged)
→ **new:** one push per paired device: *"Your week of {date} is ready — {n}
videos."* Deep link straight to the plan. Telegram stays for the group; the
push is additive, never a replacement.

### Capture: attached to a card, always

- From a card ("V-7"): **Film it** opens the camera with the brief as an
  overlay — title, location, wardrobe/camera/takes lines, the hook, and the
  shot scaffold from `transcripts.shots` when the Mac has measured it. This
  is why the app exists; get it right.
- Or **Upload what you already shot** — `expo-image-picker`, multi-select,
  one card at a time (or "Send to the team" for anything that isn't on the
  week).
- A take that lands on a card sets `filmed_at` if it was null (same signal
  the dashboard already reads; she can still un-film). It appears on the
  console's model sheet and on the editor's page (`/e/<token>`), beside the
  Drive folder that keeps working exactly as it did.
- Offline-first: files persist locally (expo-file-system) until upload is
  confirmed; retry with backoff; "upload on Wi-Fi only" default ON.

### Upload destination: Vercel Blob, browser-direct

R2 exists to push reference video *to* her with free egress; it is the wrong
door for her footage (the Mac holds the only delete credentials — see
`MODEL-PORTAL.md` "the worker uploads, not the app"). Vercel Blob is already
wired for browser-direct uploads (`/api/uploads/photo`, `/api/uploads/intake`,
`@vercel/blob/client` `handleUpload`, `BLOB_READ_WRITE_TOKEN` in env). Her
take goes: device → Blob directly (multipart, no serverless body limit) →
one row records it. The console reads it; the editor page links it.
Retention: footage objects are deleted 90 days after delivery (her Drive
folder remains the archive) — this is the one place Blob costs money, so it
gets a retention rule on day one. OPEN: later, the Mac worker could pull
Blob → her Drive folder automatically; not in this build.

### Read-only does not mean no writes ever — it means writes ship in order

Phases below. Nothing skips ahead: a phase is done only when its verification
section passes, on TestFlight against the Test Dummy model.

## The app system — every screen

This is the whole shape, decided 2026-10-10. Phase R builds all of it in
read-only; later phases only make the controls live. Design first, wire later.

### Tabs — five, no more

| Tab | What it is | Root of |
|---|---|---|
| **Home** | The week at a glance, what to do next | `loadPlan` |
| **Plan** | The full week, every card, all history weeks | `loadPlan` |
| **Picks** | The Discover deck + her starred shelf | `discover` |
| **Inbox** | Replies, plan-sent events, upload receipts | `plan_messages`, `plan_events` |
| **You** | Her profile, her look, devices, sign out | `portal_style`, `run` |

Icons: one family, one weight (SF Symbols — native, free, premium by default).
Tab bar is ink-on-bone / bone-on-ink, hairline top, no badge theatre — the
unread dot on Inbox only.

### Onboarding — four screens, under a minute, no account

She already has an identity: the link. Onboarding's only job is to make her
feel the room is hers and to earn two permissions. Nothing is required.

1. **Welcome** — her photo (from `models.photo_url`) and name, full-bleed on
   the ink ground. *"Hey Blair. This is your studio."* One button: **Come in**.
   (If the token is dead: a single quiet screen — *"This link no longer
   works. Message the team and we'll send a fresh one."* — and nothing else.)
2. **How it works** — the same five standing beats the page carries, as one
   screen of three lines and a small animated card: *watch the reference ·
   film it your way · send it up*. Copy plain, no exclamation marks.
3. **The tap** — notification permission, asked only after the value is
   stated: *"When your week is ready, we'll tap you. Nothing else."* A
   **Maybe later** button that is genuinely fine (push is Phase 2 anyway).
4. **Make it yours** — her look: the `portal_style` palettes as swatches,
   her name/pic editable, previewed live on a mini card. **Skip** is a
   first-class answer. Done drops her on Home.

Permissions for camera and photos are **never asked here** — they are asked
inside the first "Film it" and the first "Upload", contextually, the way iOS
wants them asked anyway.

### Home — the premium page

Not a KPI row, not card soup. One dominant thing (this week), one action
(film next), quiet everything else.

```
┌─────────────────────────────────────┐
│  good afternoon, blair        [·]   │   greeting by her timezone · avatar
│                                      │
│  ██ THIS WEEK ████████████████████   │   ink block, bone type
│  Week of 13 October · due Sunday     │
│                                      │
│  5 of 14 filmed        ●●●●●○○○○○    │   big tnum + segment ticks
│                                      │
│  [ Film next — V-3 Car GRWM  → ]    │   the one primary button
│  [ Send it up · 2 takes waiting ]    │   appears only when takes exist
│                                      │
│  Drop-off: Drive folder ↗            │   delivery strip, quiet
│                                      │
│  FRESH PICKS FOR YOU                 │
│  [poster] [poster] [poster]  →       │   horizontal rail into Picks
│                                      │
│  TEAM                                 │
│  Ella replied on V-7 · 2h            │   into Inbox, unread bold
└─────────────────────────────────────┘
```

- **Primary action logic (fixed order):** unfilmed cards today (per
  `filming_days`) → oldest unfilmed card → "you're clear this week" state with
  the deck as the action. The button never says anything twice.
- **Empty (no sent plan yet):** the whole hero is a quiet illustration +
  *"Your first week is being built. You'll get a tap when it's ready."* — and
  the deck stays live underneath. The deck is what makes an empty Home worth
  opening.
- **States:** skeleton on cold open (shaped like the hero, not a spinner);
  offline = a hairline banner *"You're offline — showing the week we last
  fetched"*, never a blocked UI; deferred push = nothing.

### Plan — the week, exactly as the page has it

- Week rail across the top (history weeks, current one default), the same
  "nearest sent week" logic (`currentPlanFor` — the app never picks a week
  the web wouldn't).
- Header: progress ticks, due countdown, the six standing beats collapsed to
  an info disclosure — she has read them; the page shows them once, Home
  links them.
- Cards grouped by `location` as **runs, not buckets** (the phase-4 rule),
  `V-<card_no>` pill, status chip (untouched / accepted / declined / filmed)
  — chip is text + weight, not colour-only.
- Card opens the full brief (Phase R parity list above). Whether it opens as
  a pushed page or a sheet: **page** — filming starts from there and a sheet
  would fight the camera.

### Picks — the deck, full-screen

The web deck is Tinder for references; native makes it better: poster,
muted preview loop when the Mac is awake, one tap for sound (the web's own
rule — the deck plays muted until asked). Star/pass. The starred shelf is a
grid under the deck; "put it on my week" stays web-only in v1 (OPEN).

### Inbox — one list, two kinds of rows

The thread per card stays the conversation; Inbox aggregates.

- Rows: operator reply on V-7 (opens card thread), plan sent / week carried
  events, upload receipts ("V-3 landed with the team"), nudges.
- Sourced additively: `plan_messages` unread + `plan_events` for her + the
  new upload rows. Read = the same `seen_at` mechanics, both directions.
- Empty: *"Nothing yet. The team's replies show up here."*

### You — hers

Profile (photo, name, handle), **her look** (Make it yours — same palettes),
**her run** (the `run` stats, rendered quietly, not a Eurovision board),
devices (her phones, revoke), delivery info (`drive_url` / `delivery_note`),
message the team (a plain DM that lands in the group / console queue),
sign out. Sign out kills the device credential only — the plan link stays
hers.

### Premium, defined (what "premium shit" means in this build)

- **Restraint.** One accent (ember), hairline rules, bone/ink grounds. No
  gradients-for-gradients, no confetti, no streak gamification, no badge
  clutter. Calm reads as expensive.
- **Type does the work.** Big week numbers and progress in tabular figures
  (`--sc` mono numerals), uppercase micro-labels with tracking, body in the
  house sans. Numbers are the jewellery.
- **Haptics, earned.** Light tick on filmed, soft double-tap on upload
  sent, medium on camera start/stop. Nothing buzzes unless something
  happened.
- **Motion, from `motion.css`'s vocabulary** — springs, reveals, the ring
  confirm — translated to native (`Reanimated` spring configs mirroring
  `--sc-spring`). Reduce Motion collapses all of it, per the phase-9 rule.
- **The phone does phone things.** Live Activity while filming (later,
  OPEN), home-screen widget with the week's ticks (later, OPEN), share-sheet
  receiving an IG link → *send to the team* (later, OPEN). These are the
  reasons this is an app and not a bookmark.

## Phases

### Phase 0 — scaffold (no product surface)

- New repo `app/` beside `cloud/` (**OPEN: name and bundle id** — suggestion
  `com.sinauraco.plan`; the layer tree and Xcode project use "her plan", not
  a brand, until Geno names it).
- Expo current SDK, TypeScript, `expo-router`. EAS build configured for iOS.
  TestFlight internal first.
- A tiny `lib/api.ts` that is the app's only network door: `base url +
  credential`, JSON, typed against hand-mirrored types from `plans.ts`
  (PlanModel, Plan, PlanItem, PlanMessage — copied, not imported; the app
  lives in its own repo and types are the contract).
- **A test model ("App Test") is created for development, the way temporary
  models were stood up for the batch verification, and deleted before ship.**
  Never open a real creator's `/p/` link in dev: the first load stamps
  `opened_at`, and faking that signal is corrupting the one thing that
  distinguishes "never opened it" from "ignored it" (`PORTAL-V2.md`, phase 12).
- Verification: app boots, pairs with App Test's token, prints the plan
  count. No screens yet.

### Phase R — read-only parity (the first TestFlight)

The whole plan page, native. Screens:

1. **Week** — her photo/name, week of + due date, progress ticks (one per
   card, countable), delivery block at the foot (`drive_url` /
   `delivery_note`), the six standing beats, groups by `location`.
2. **Card** — title + `V-<card_no>` pill, reference player (`expo-video`
   with the presigned URL; refresh the whole plan on any 403 — R2 URLs live
   6h, `R2_URL_TTL_SEC`), "Open in Instagram", download, the brief as the
   page renders it (wardrobe/camera/takes/sound fields, hook callout,
   caption with copy button, direction prose fallback when fields are null),
   collapsible speaker-labelled transcript, the thread (read-only history),
   rating/made-it shown as state.
3. **Deck** — `discover` view-only: swipe/tap through posters, no star/pass
   writes yet.
4. **Her run** — `run` stats, read-only.
5. **Settings** — her look (`portal_style` pal/font) previewed, theme
   light/dark/system following the OS, sign out (revokes the device
   credential locally; the model's token is untouched).
- Every control that will later write renders **disabled with a quiet note**
  ("Filming starts soon"). Do not hide them — she should already see the
  shape of it.
- Verification: side-by-side screenshots vs `/p/<token>` at 390pt and
  320pt-class widths, both themes; every control driven with network
  recorded — zero mutating requests; a revoked token 404s the app to the
  "link no longer works" screen.

### Phase 1 — writes, parity with the existing endpoints

Wire the controls the web already has, endpoint for endpoint, no new
mutations invented: `filmed` toggle (with the big button confirming by ring,
as the page does), `verdict` accept/decline incl. `decline_code` chips above
the textarea, `message` thread (send + unread badge + autosave semantics:
writing a verdict calls save, never toggle — see the phase-11 trap),
`rate` thumbs, `made` (link paste, Instagram/TikTok only, same regex),
`survey` (only where the console sent one), `style` (Make it yours, writes
`portal_style`).

- Optimistic UI is allowed for `filmed`/`rate` only, with rollback on
  failure. Thread messages send-then-show. Everything else confirms first.
- Verification: for every endpoint, app action → identical DB effect to the
  web page's action (compare rows before/after), network failing gracefully,
  airplane mode mid-action never loses a typed message.

### Phase 2 — notifications (the dashboard reaches her phone)

Schema (additive, `migrate.mjs`):

```sql
create table if not exists transcriber.app_devices (
  id          text primary key,
  model_id    text not null references transcriber.models(id) on delete cascade,
  label       text,                    -- "iPhone 15" from the app, for the sheet
  push_token  text,                    -- Expo push token; null until granted
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at  timestamptz
);
create index if not exists app_devices_model_idx
  on transcriber.app_devices (model_id) where revoked_at is null;
```

- Routes: `POST /api/app/pair` (token → device credential row),
  `POST /api/app/device` (register/refresh push token), `POST /api/app/leave`
  (revoke self).
- Sends (server-side, one helper in `cloud/src/lib/push.ts`; Expo Push
  Service first — no raw APNs cert wrangling at this stage):
  - plan sent → every live device of that model;
  - operator message on a sent plan → that model's devices ("New reply on
    V-7"), mirroring the bot's relay, not replacing it;
  - nudges: reuse `lib/reminders.ts` windows (and her `timezone`, never a
    hardcoded Eastern clock) inside the existing `api/cron/daily` pass —
    one push per window, never a second, state in `app_devices`/a small
    `app_notifications` log table if dedupe needs a home;
  - a revoked device gets nothing: join `where revoked_at is null`.
- Console: her sheet gains a "Devices" list (label, last seen, revoke).
  Revoking the account token (`token_revoked_at`) also revokes every device —
  in the same save, not a background job.
- Copy rules: no urgency theatre. "Your week of 13 October is ready."
  "Ella replied about V-7." Nothing at night in her timezone unless the
  operator sent it manually.
- Verification: real device, all three trigger kinds, airplane-mode device
  re-registers on next open; dedupe proven by running the cron twice;
  revoked device silent; App Test only until a real model asks in.

### Phase 3 — capture (film it, in the plan)

- **Film it** from a card: `expo-camera` viewfinder with the brief overlay
  (title, location, wardrobe/camera/takes/hook, shot scaffold from `shots`
  when present, "hands-free: 3-2-1" countdown), front/back, torch, retake
  within the session, duration guide from the reference's `duration_sec`
  (±25% hint, never enforced).
- Takes are stored locally first (`expo-file-system`, app container — not
  her camera roll, unless she taps Save to Photos). One take per attempt;
  keep the best is her edit, we do not trim in v1.
- The overlay is the product: it is the page's brief, re-set for a
  viewfinder. Same words she reads now.
- Verification: film on a real device against App Test's week, kill the app
  mid-take — no lost take vs the local store; overlay legible at arm's
  length, both themes; reduce-motion honored.

### Phase 4 — upload (it lands in the console)

Schema (additive):

```sql
create table if not exists transcriber.plan_uploads (
  id         text primary key,
  model_id   text not null references transcriber.models(id) on delete cascade,
  item_id    text references transcriber.plan_items(id) on delete set null,
  blob_url   text not null,
  filename   text,
  bytes      bigint,
  duration_sec real,
  source     text not null default 'app' check (source in ('app','web')),
  status     text not null default 'new' check (status in ('new','seen','delivered','archived')),
  created_at timestamptz not null default now(),
  seen_at    timestamptz,
  archived_at timestamptz
);
create index if not exists plan_uploads_model_idx
  on transcriber.plan_uploads (model_id, created_at desc);
```

- Route `POST /api/plan/[token]/upload` + `/complete`: `handleUpload`
  browser-direct to Blob (multipart), then one row. `item_id` optional —
  null means "Send to the team".
- Attached → `filmed_at = now()` when null. Detached uploads show on her
  model sheet under a small "Sent to the team" list.
- Console: model sheet "Footage" rail (thumb, duration, card no., download);
  the editor's page `/e/<token>` lists uploaded files per card next to the
  folder link. Retention job: `status='delivered'|'archived'` and
  `created_at < now() - 90 days` → delete object, stamp `archived_at`.
  One code path, like R2 trash — never ad-hoc deletes.
- Copy: she should never wonder if it arrived. The card says "Sent to the
  team · just now", and it stays said.
- Verification: a real 4K/60s take over cellular uploads and resumes after a
  kill; duplicate tap never double-uploads (idempotency key per take); the
  editor page and model sheet both show it; retention job proven on a fake
  old row (and it deletes, not blanks).

### Phase 5 — polish and the extensions that already exist on web

- Deck goes writable (star/pass = the existing `discover` POST; starred
  shelf → "put it on my week" exists on web — decide here whether the app
  gets it; **OPEN**, default no in v1).
- Spanish (deferred in `PORTAL-V2.md` too — if it ships, it ships for both
  surfaces in one pass; do not fork strings).
- App icon/splash from the existing `pwa-icon` precedent; screenshots;
  App Store copy in her plain register.
- Android: Expo makes it cheap, but it is not this build. Do not block iOS
  on preparing it.

## Traps — from our own history, extended

- **The `var(--token)` audit** (`PORTAL-V2.md` phase 1): run it after any
  stylesheet touch; an undefined var resets the *whole property*, not one
  fallback.
- **The two dark `:root` blocks** in `globals.css` and `plan.css` must stay
  byte-identical; edit both or neither. The app's theme tokens mirror the
  same values; they are a copy in the app, and a copy drifts — pin them in
  one `tokens.ts` with a test against `tokens.css`.
- **`.plan-no` is two things** (badge + decline button). Every badge rule
  goes through `.plan-item-head`. The app'll be tempted to merge these —
  don't.
- **Dates cross the wire as `YYYY-MM-DD` strings.** Never `Date` objects.
  Never local-parse a plan week; it lands a day early in Hawaii.
- **Cast nullable params in SQL** (`case when $2 is null` can't be inferred)
  and keep regexes out of template literals (`\d` → `d`).
- **The rate limiter is per-instance and best-effort** — fine for her taps,
  never load-bearing for auth.
- **R2 presigned GETs expire in 6h** (`R2_URL_TTL_SEC`). The app refreshes by
  re-fetching the plan, not by string surgery on the URL.
- **Only one Neon database** — previews read production (phase-7 note). App
  dev runs against App Test; that is not a suggestion.
- **`vercel deploy --prod` from `cloud/` is the deploy**; aliases are
  listed in `NEXT-PORTAL.md`. Do not create a second Vercel project for the
  app's web bits (AASA, upload callbacks) — they live in `cloud/`.
- **`env pull` overwrites `cloud/.env.local`** — back it up before any
  `vercel` subcommand that might run it.
- **Expo specifics:** `expo-video` (not the deprecated `expo-av`);
  `expo-secure-store` for the credential (Keychain — never AsyncStorage);
  background uploads on iOS are limited — the honest design is foreground
  upload with local persistence and retry, not a background daemon; universal
  links need the real domain (see Decisions).
- **Apple:** guideline 1.1.4 (no adult links), 4.2 (we pass — camera, push,
  offline), 5.1.1(v) if any account deletion is implied (device revoke in
  Settings covers it). TestFlight external review wants a demo path: it is
  App Test paired from a QR/deep link in the review notes.

## What NOT to build

- No second sender: plans are sent from the console, full stop.
- No editor parity (the `/e/<token>` page is fine as web).
- No OF/earnings/adult surfaces — console and web only.
- No chat app: the thread per card is the conversation, not an inbox.
- No auto-posting to Instagram/TikTok from the app. That is a different
  product with a different risk profile.
- No re-implementation of the plan in the app's own headless API. The app
  calls `/api/plan/[token]/*` and consumes `loadPlan`'s JSON. If the app
  needs a field, add it to `plans.ts` for both surfaces (additively).

## Verification philosophy (how we know it shipped)

Every phase ends the same way this repo always proves things:

1. Typecheck/build clean on both sides; `npm test` in `cloud/` stays green
   (the app adds its own tests in its own repo).
2. The Test Dummy/App Test model only, in production previews.
3. Screenshots at narrow widths, both themes — the `cdpshot.mjs` habit,
   ported: simulator screenshots, dark and light.
4. **Drive every control with the network recorded.** Read-only phases prove
   zero mutations; write phases prove exactly the mutations they claim and
   no others.
5. One real human, one real phone, one full week: sent → pushed → opened →
   filmed → uploaded → seen in console. That is the acceptance test for the
   entire build.

## OPEN — Geno decides, the builder asks before assuming

1. App name, bundle id, icon direction.
2. First real creator to TestFlight — and who tells her it exists.
3. Footage retention: 90 days is the suggestion; longer costs Blob storage.
4. Whether the app's "sent to the team" also pings the Telegram group
   (bot parity) or stays app/console-only.
5. Coach/countdown niceties in the viewfinder (v1 keeps it sparse).
6. On "put my starred deck picks on my week" (web has it; app v1 says no).
