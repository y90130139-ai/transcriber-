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
