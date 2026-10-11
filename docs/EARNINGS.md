# Earnings (Infloww → portal → Telegram)

Built 2026-09-30. OnlyFans earnings for every creator, from Infloww's read-only
API, shown internally on **Dashboard → Earnings** and on each model's **Earnings**
tab, and reported to creators through the Gosian bot.

## Decisions (Geno, 2026-09-30)

| Question | Answer |
|---|---|
| What creators see | **Net** (after OnlyFans' 20% fee), labelled "net" |
| Wording | **Fixed templates** picked by the numbers — no model writes anything |
| Approval | Every report and win is a **draft in GOSIAN \| OPS** with Approve & send / Skip for the first month; `EARNINGS_AUTOSEND=1` on Vercel turns that off |
| Dashboard | **Creator-level only.** No table has a fan column; fan fields are dropped in `infloww.ts` before anything else sees them |

## How it runs

- **Cron** `/api/earnings/pull` at 13:00 UTC (9 ET) — `lib/earnings/job.ts`:
  1. sync the account list (`/v1/creators`); an account that vanishes is an OPS
     alert and is paused, one that returns resumes;
  2. pull each account up to now — new accounts backfill 120 days in 30-day
     windows, every run re-pulls the last 4 days because OnlyFans settles and
     reverses late; a run out of time keeps what it saved and calls itself again;
  3. once every account behind a model is current: a **win** for yesterday
     (1.5× her 28-day median and ≥ $150 net, or best in 30/90 days; ≤ 2 a week),
     on Mondays the **weekly** for the week just ended, and OPS **alerts** for a
     day or week down more than 25%, unmatched accounts and models with no group.
- **Mac**: `npm run earnings` (from `cloud/`) runs the same job with no time
  limit — used for the first backfill. `-- --no-draft` pulls without drafting.
- **Bot**: see "Earnings reports" in `~/gosian-bot/CLAUDE.md`.

## Matching accounts to models

Infloww has 31 accounts; some creators have two (Free + VIP). Each account is
matched to a roster model **by hand** in Dashboard → Earnings. A model's report
sums all her matched accounts. An unmatched account is never reported to anyone.
A message only ever goes to `models.telegram_chat_id` of the matched model, and
is re-checked at the moment it is approved: relinking a model's group after a
draft was made voids that draft.

## Money rules

- Amounts are Infloww's string cents. `undo` and `pending_return` are dropped.
- `loading` (≈ last 3 days, unsettled) counts but is tracked separately; a win
  or week that is more than half unsettled says it may still move.
- Days are New York days (`days.ts` `dayOf` / `startOfDay`, DST-safe).
- Comparisons only use history we hold: no "vs last week" on a first week, no
  "best in 90 days" on 40 days of data.

## Env (Vercel + `cloud/.env.local`)

`INFLOWW_API_KEY` (raw key, sent without "Bearer"), `INFLOWW_OID` (agency id,
`1877353357967393`), optional `EARNINGS_AUTOSEND=1`.

## Tables

`earnings_accounts`, `earnings_days`, `earnings_messages`, `earnings_alerts` —
see the end of `cloud/scripts/migrate.mjs`.

`earnings_alerts.audience` (2026-10-10) decides who the bot tags in its MODEL
PERFORMANCE topic: `money` (Paige, Geno, Marinko) for everything out of
Infloww, `social` (Geno, Iona) for the Instagram reads. It defaults to `money`,
so every earlier row behaves exactly as it did. The table is shared because the
bot drains one queue; the column is all that splits the tag lines.

## The weekly story read (2026-10-10)

Scout's daily pass is the only thing that can see Instagram stories at all — a
story is gone in 24h, so `creator_snapshots` records once a day whether one was
up, giving days-with-a-story over days-looked-at.

Every **Monday**, `/api/cron/daily` (or `?job=stories`) calls
`storyCadenceAlerts()` in `cloud/src/lib/performance/stories-job.ts`, which
writes one `social` alert for Geno and Iona to act on by telling the model
herself:

- **🔴 Slipping** — under 50% of the days looked at, with **nothing at all**
  named first and worst-first after that
- **🟢 Keeping it up** — 80%+, best first
- 50–79% says nothing; silence beats a message nobody can act on
- **⏳ Too new to say** — fewer than 3 readings, one line, so a model nobody has
  looked at never reads as fine
- A model with **no Instagram handle** is left out entirely: that is a portal
  gap, not a story habit

Thresholds and wording are pure and tested in `cloud/test/stories.test.ts`;
`stories.ts` holds them and has no database import. Keyed `stories:<monday>`,
so a retry in the same week writes nothing twice.

## Added 2026-09-30 (second round)

- **Monthly recap** (#6) on the 1st (retried the 2nd/3rd) and **milestones** (#5)
  the morning after: beat her best month, a round figure no earlier month
  reached, a new-subs count none did. "On record" = whole months we hold, never
  fewer than two. `lib/earnings/monthly.ts`. OPS-approved like the rest.
- **Reels and money** (#1), internal only: each posting day's best reel vs her
  usual views, against her net that day and the next vs her usual two days.
  Model → Earnings tab, and "Reels that moved money" on Dashboard → Earnings.
  Timing, not proof. `lib/earnings/reels.ts`.
- **Win-back list** (#11): Monday (retried Tue/Wed) OPS-only post of fans who
  spent $500+ in 90 days and went quiet 14+ days, 5 per creator, 30 total.
  **Fan IDs only** — `earnings_fan_days` has no name column; names (where chatters
  write notes) are dropped in `infloww.ts`. Only accounts pulled cleanly that day
  are listed. `lib/earnings/winback.ts`.

## Inactive models

Profile header → **Deactivate** (Unresponsive / Left / Other + note) or
**Reactivate**. Sets `models.status = 'paused'` plus `inactive_reason`,
`inactive_note`, `inactive_since`; the roster greys her out in an Inactive group.
Everything portal-side already skips paused models, and the Gosian bot reads
`/api/bot/inactive` to stop its marketing messages (invoices and birthdays
continue). `lib/inactive.ts`, `api/models/[id]/active`.
