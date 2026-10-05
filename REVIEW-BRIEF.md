# Security review & cleanup — brief

**Project:** social-transcriber (SinauraCo internal content tool)
**Owner:** Geno — contact@sinauraco.com
**Prepared:** 2026-10-04
**Ask:** a security review and a cleanup pass so this can be run as an official,
maintained tool. Keep it recognisably the same system. Suggestions beyond that
are welcome — see [Where you have a free hand](#where-you-have-a-free-hand).

---

## 1. What this is, in one paragraph

An internal tool for a creator-management agency. It turns Instagram Reels and
TikToks into speaker-labeled transcripts **on a Mac** (whisper.cpp, local
diarization, Apple Vision OCR), stores the results in a **hosted library** on
Vercel, scores posts against each creator's own median, and builds a **weekly
content plan** for each managed model, who opens it on her phone through a
private link. Around that core: a scheduled Instagram intake ("Scout") using a
burner account and Apify, OnlyFans earnings pulled from Infloww, a Telegram bot
integration (separate repo) that relays messages and approvals, and an
LLM assistant (`/q`) that answers OPS questions from live data.

Users: Geno and a small OPS team (console, one shared password), the managed
models (portal links), and the Telegram bot (machine-to-machine).

## 2. What is in this repository — and what is not

You're getting the working repository itself (`sinaura-co/social-transcriber`,
private), full history included. Please work on a branch and open pull requests
into `main`. Added for you:

- `cloud/.env.example` — every environment variable the web app reads, names only.
- `config.example.json` — the Mac side's config shape.
- `ops/launchd/*.plist` — the seven scheduled jobs that run on the Mac (paths only, no secrets).

**Not in the repo (gitignored, never committed):**

| Missing | Why | How you get it |
|---|---|---|
| `cloud/.env.local`, `config.json`, `secrets/` | Live credentials and Instagram session cookies | Not needed for a code review. If you need to run against real services, ask — you'll get a separate, scoped set, not production keys |
| `vendor/`, `.venv/`, `cloud/node_modules/` | Downloaded toolchain and models (~GBs) | `./setup.sh` and `cd cloud && npm ci` |
| `out/`, `inbox/` | Downloaded videos and transcripts (~16 GB) | Not needed |

A regex scan of the full history for keys, tokens and passwords came back clean
(2026-10-04). Two things in the repo are **data, not code**, and should be
treated as confidential: the JSON dumps in `docs/rollback/` (real creator
handles and plan notes), and a test model's portal link in older revisions of
two docs (now redacted; it will be revoked). Whether to purge them from history
is one of your calls to recommend.

## 3. Architecture

```
            ┌───────────────────────── Vercel (cloud/) ─────────────────────────┐
 OPS team ─▶│ Console (Next.js 16, React 19)   password → signed session cookie │
 Models   ─▶│ Portal /p/<token>                 unguessable per-model token     │
 Telegram ─▶│ /api/bot/*                        GOSIAN_BOT_SECRET bearer        │
 Vercel   ─▶│ /api/cron/*, earnings pull        CRON_SECRET bearer              │
 Apify    ─▶│ /api/scout/apify-hook             CRON_SECRET (see §6)            │
            │       │ Neon Postgres (raw SQL, @neondatabase/serverless)         │
            │       │ Cloudflare R2 (plan videos) · Workers AI · Anthropic API  │
            └───────┼────────────────────────────────────▲─────────────────────┘
                    │ /api/worker/* (WORKER_SECRET)       │ signed, expiring URLs
            ┌───────▼──────────── Mac (src/, bin/) ───────┴─────────────────────┐
            │ bin/worker   polls the queue, transcribes, uploads text + frames  │
            │ mediaserv    127.0.0.1 only, exposed by a cloudflared tunnel;     │
            │              every URL HMAC-signed with WORKER_SECRET + expiry    │
            │ bin/serve    local drop UI, 127.0.0.1:8765                        │
            │ Scout/viewer Playwright + yt-dlp on a burner Instagram account    │
            │ launchd      7 scheduled jobs (ops/launchd/)                      │
            └───────────────────────────────────────────────────────────────────┘
```

| Part | Stack | Size |
|---|---|---|
| `cloud/` | Next.js 16 (App Router), React 19, TypeScript, Neon Postgres via tagged-template SQL (no ORM), Node test runner | ~327 source files, 114 API routes |
| `src/`, `bin/` | Python 3.9 (system Python, stdlib HTTP servers, Playwright, sherpa-onnx), two small Swift tools (OCR, frame look) | 35 modules, 16 entry scripts |
| `setup.sh` | Pinned downloads of yt-dlp, ffmpeg, whisper.cpp, models, cloudflared into `vendor/` (no Homebrew, no sudo) | |
| `docs/` | Design notes and session handoffs | ~30 docs |

**Start here:** `README.md` → `docs/REBUILD.md` (the from-zero rebuild guide) →
`docs/CONTENT-LIBRARY.md`, `docs/MODEL-PORTAL.md`, `docs/PORTAL-V2.md`,
`docs/SCOUT.md`, `docs/EARNINGS.md`. `cloud/scripts/migrate.mjs` is the whole
schema (additive, re-runnable).

**Current baseline:** `cd cloud && npm test` → 100 pass, 0 fail. `npx tsc --noEmit` is clean on a fresh install. There are no Python tests, no linter config
and no CI.

## 4. Auth model, route by route

Every API route was checked for which guard it uses:

| Guard | Routes | Mechanism (`cloud/src/lib/auth.ts`, `cron.ts`) |
|---|---|---|
| `isSignedIn` | 52 (+ several mixed) | `APP_PASSWORD` → HMAC-signed `tx_session` cookie, 60-day max age, stateless |
| `isBot` | 22 | `Authorization: Bearer GOSIAN_BOT_SECRET` |
| `isWorker` | 16 (+ mixed) | `Authorization: Bearer WORKER_SECRET` |
| `isScheduler` | 6 | Vercel cron header or `Bearer CRON_SECRET` |
| Portal token | 10 (`/api/plan/[token]/*`) | Possession of the model's `access_token` (revocable via `token_revoked_at`); most are rate-limited (`lib/ratelimit.ts`) |
| `checkPassword` | `/api/auth` | Constant-time compare |

## 5. Secrets inventory (names only)

- **Web app:** see `cloud/.env.example` (20 variables).
- **Mac:** `config.json` → `cloud_url`, `worker_secret`, `r2.*`, `scout.apify_token`,
  `scout.burner_cookies`, `scout.max_usd_per_run`.
- **Mac `secrets/`:** Instagram burner cookies + Playwright storage state
  (`scout-*`; `viewer-*` are currently symlinks to the same account), alert and
  session-health state, a per-day view budget. All plaintext on disk, mode 600.

## 6. What we already know or suspect — please verify, rank, and fix or advise

Don't take this list as complete. It's here so you don't spend time rediscovering
what we already know.

1. **`WORKER_SECRET` does two jobs.** It authenticates the worker *and* signs
   media URLs. A leak of one is a leak of both.
2. **No rate limit on `/api/auth`.** A single shared password with no lockout.
   There is also no per-person identity, so there is no audit trail of who did what.
3. **Sessions can't be revoked** short of rotating `SESSION_SECRET` (stateless
   60-day cookie).
4. **Apify webhook authenticates with `CRON_SECRET`.** That secret travels to a
   third party inside the webhook definition.
5. **Portal tokens are bearer links.** They show up in Telegram messages and
   browser history. Check entropy, revocation, and what a token can write
   (`message`, `made`, `verdict`, `rate`, `filmed`, `survey`).
6. **`/q` assistant (Anthropic).** It reads creator-written text and drafts
   messages to creators. Check for prompt injection, and confirm drafts can't be
   sent without the owner's tap (`OWNER_TELEGRAM_ID` + the bot's own check).
   Not yet live in production.
7. **Instagram automation.** Burner-account cookies sit on disk in plaintext,
   yt-dlp and Playwright browse as that account, and third-party public profiles
   are stored. Please flag platform-ToS and privacy exposure; we don't expect
   you to solve it.
8. **The Mac is part of production.** A cloudflared tunnel points at a loopback
   server. Check the signing, expiry ceiling, path handling (no traversal out of
   `out/`), and what happens if the tunnel URL leaks.
9. **Supply chain.** `setup.sh` downloads binaries over HTTPS with **no checksum
   verification**, and cloudflared is pulled from `latest`. Python deps aren't
   pinned (no `requirements.txt`). `npm audit` hasn't been reviewed.
10. **Input handling.** URL/handle parsing feeds `yt-dlp` and `ffmpeg`
    subprocesses. Uploads go through `/api/uploads/*`. All SQL should be
    parameterised; please confirm there's no string-built SQL anywhere.
11. **Hygiene.** `docs/rollback/` is a folder of hand-made pre-edit copies
    (~190 files) that git now makes redundant. `docs/` holds many dated
    handoffs. There are no lint/format/CI configs, and the Python tooling
    targets the system 3.9.

## 7. Scope

**Security (priority):** authn/authz on every route, secret handling and
rotation, injection (SQL, command, path, prompt), SSRF (the app fetches
user-supplied URLs), upload handling, data exposure through the portal and bot
APIs, dependency and supply-chain risk, headers/CSP on the Next app, logging
of sensitive data.

**Cleanup:** dead code, duplicated logic, oversized files and functions,
consistent error handling, Python packaging/pinning, a lint and format setup
that matches the existing style, a minimal CI (tests + build), and pruning
`docs/` into a smaller set of current documents.

## 8. Keep it like ours

These are deliberate choices. Please keep them unless you have a reason, and
if you do, tell us the reason rather than changing them quietly:

- **Raw SQL with tagged templates, no ORM.** Migrations stay additive and re-runnable in `migrate.mjs`.
- **Pure logic in `cloud/src/lib/*` with unit tests next to it** (`cloud/test/`), DB access kept separate (e.g. `week-shape.ts` pure vs `week-load.ts` DB).
- **Comments explain *why*, in plain English,** and often say who decided and when. Keep that voice.
- **TypeScript style as found:** no semicolons, single quotes, small modules.
- **Mac side stays dependency-light:** stdlib servers, vendored binaries via `setup.sh`, no Homebrew, no sudo.
- **Video never leaves the Mac** except plan videos to R2. Only text and poster frames go up.
- **Plain-language UI copy** — the models are not technical.
- **Nothing reaches a creator without a human tap.** Drafts, recaps and messages are approved before they're sent.

## 9. Where you have a free hand

Restructuring, renaming, splitting files, replacing hand-rolled pieces with a
well-known library, or proposing a different auth model (per-user accounts,
for example). Open to all of it. For anything that changes behavior or
architecture, **propose it first** (a short note or an issue) rather than
landing it inside a cleanup commit. Purely mechanical cleanup can go straight in.

## 10. Ground rules

- **No production access is needed for the review.** Please don't run
  `migrate.mjs`, deploy, or contact Instagram, Apify or Infloww with real accounts.
- **One concern per commit,** conventional messages (`fix:`, `refactor:`,
  `chore:`, `docs:`, `test:`).
- **Keep the tests green.** Add tests for anything security-relevant you fix.
- **Don't commit secrets.** If you need credentials, ask.
- **Return work as pull requests** into `main`, one branch per theme.

## 11. What we'd like back

1. **Findings report.** Each finding gets a severity (Critical / High / Medium / Low),
   the file and line, a concrete exploit or failure scenario, and a fix (or a
   recommendation if it's an owner decision).
2. **The fixes,** as commits on top of the baseline.
3. **A short list of proposed changes** you didn't make, with their trade-offs.
4. **Anything we must do on our side:** secret rotation, Vercel settings, account changes.

## 12. Running it locally

```bash
# Web app
cd cloud
npm ci
cp .env.example .env.local      # DATABASE_URL can point at any empty Postgres
npm test                        # 100 tests, no DB needed
npm run build

# Mac side (Apple Silicon, macOS)
./setup.sh                      # downloads toolchain + models into vendor/
cp config.example.json config.json
./bin/transcribe ~/Downloads/some-clip.mp4   # fully offline path
```

The complete walkthrough is `docs/REBUILD.md`.
