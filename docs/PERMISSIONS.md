# Team permissions for the console (shipped, 2026-10-18)

**What it is.** Every teammate gets per-page access to the transcriber
console — **Off / View / Edit** — set from the ai-invoice dashboard's Team
screen (the one place the whole team is managed), and enforced everywhere in
this app: the rail, the pages, and every API behind them.

## The model — same words, same storage

Levels and vocabulary are the ai-invoice dashboard's own: **`none | read |
edit`** (labels No Access / Read / Write; the console renders Read as
"View only"). Stored in the same `team_members.page_permissions` JSONB:

```
page_permissions = {
  transcriber: 'read',              // the door AND the default level
  'transcriber.models': 'edit',     // per-page override; absence = inherit
  'transcriber.library': 'edit',
}
```

- **`transcriber`** — the master: may they use the app at all, and at what
  level by default. Legacy `read` behaves as View everywhere; `edit` as Edit
  everywhere. (`read` members now actually lose the ability to save, which is
  what "read" always claimed to mean — the app never enforced it before.)
- **`transcriber.<page>`** — per-page override, wins over the master in both
  directions (`none` denies a page the master allows; `edit` grants one the
  master denies). Master `none` + one override is a real setup — an editor
  with exactly one page.
- **Scheduler and Client are restricted** (`RESTRICTED_PAGE_KEYS`): they stay
  closed for members even under an open master. Admin and CEO have them by
  role; everyone else is granted them page by page from the dashboard (the
  invite UI draws those groups as "Admin & CEO only"). Absence means **off**,
  never inherit.
- **ceo / admin** — everything, edit, always. Never from the table.

## The pages (36 keys)

`cloud/src/lib/permissions.ts` → `PAGES`, grouped as the rail groups itself:
Workspace (4) · Studio (8) · Research (3) · Creators (3) · Social Accounts (3)
· Team (2) · Client (2) · App Content (6) · Scheduler (4) · Console (Settings,
1). `Settings` is a normal grantable page. A test in
`cloud/test/permissions.test.ts` pins `PAGES` against `nav.ts` — a new rail
page fails the suite until it joins the catalog.

## Where it is enforced

1. **The rail** (`ConsoleShell`): pages the member cannot view are not
   rendered — not in the rail, not in the switcher, not in ⌘K search, and the
   assistant's suggestion is dropped when its target is denied. The same
   decisions the server makes, read from the same functions.
2. **The pages**: the shell holds a gate for client pages (a branded "No
   access" panel + bounce to the first allowed page); every server-rendered
   page (`app-accounts`, `app-content/*`, `inbox`, platform feeds, scheduler,
   `settings`, `watchlist`, the Studio tools, …) calls
   `await requirePage(key)` first. App Content is filtered twice over: the
   layout hands the client shell only the documents the member may view, and
   its API does the same.
3. **The APIs**: every console route replaces `isSignedIn()` with
   `guardAccess(request)` — **GET/HEAD need View on the page that owns the
   path; anything else needs Edit.** The mapping lives in `API_RULES`
   (`lib/permissions.ts`): one page per prefix, or a list of pages for shared
   helpers (`/api/links`, `/api/uploads`, `/api/sweep` — any one grants it).
   No rule = "any page" (still stronger than signed-in-only). Workers, the
   bot, cron, her plan tokens, the model app and the thumb/photo proxies keep
   their own auth untouched.
4. **The face of it**: a **"View only"** chip sits in the top bar when the
   open page is Read, so a refused save has a reason on screen.

Sessions: the effective map is resolved at sign-in and carried in the
`tx_session` JWT. Permission edits land at the member's next sign-in — the
note under the drawer says so. Old sessions (no map) read their legacy
`transcriber` value.

## The management UI — ai-invoice Team drawer

`TEAM_PAGES` keeps its list; the `transcriber` entry is drawn inside a new
block: a **master row** ("Every page — master"), then one **collapsible group
per rail section** (Workspace, Studio, …) with the same No Access/Read/Write
segment every other page uses. A row with no override wears the master's
level quietly (**inherit** tag); touching a segment writes the override; **↺
reset** hands it back; each group has a **Set all** row. The **Scheduler** and
**Client** groups are restricted: their rows read **Admin & CEO only** until
granted by name, and the invite also has a full-page form at `/team/invite`
with the same groups, labelled. `normalizePagePermissions` validates
`transcriber.<key>` against `TRANSCRIBER_PAGES`, so garbage keys can never be
stored. The save path and member rows are untouched.

## Rollout — what did NOT change

- **ceo/admin**, the Mac worker, the Telegram bot, cron, her plan pages by
  token, the model app, thumbnails/photos — unchanged.
- **New members** default to master `none`; a master `read`/`edit` covers
  every section **except Scheduler and Client**, which stay admin-only until
  granted by name.
- The transcriber enforces; the dashboard manages. One place for each.

## Adding a page later — the checklist

1. `cloud/src/components/console/nav.ts` — the rail leaf.
2. `cloud/src/lib/permissions.ts` — `PAGES` entry (key, label, href, group).
   *The permissions test fails until 1 and 2 agree.*
3. `ai-invoice/src/core/teamPermissions.js` — `TRANSCRIBER_PAGES` entry.

## Deploy order

The schema is unchanged (permissions live in the dashboard's existing table).
Ship the ai-invoice UI and the transcriber together; members see the new
model at their next sign-in. Rolling back the dashboard alone leaves the
console resolving legacy values exactly as before.
