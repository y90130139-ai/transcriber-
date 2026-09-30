/**
 * Earnings in the database: accounts, day rows, drafted messages, OPS alerts.
 * Relative imports only, so `scripts/earnings-pull.ts` can run this off Vercel.
 */
import { customAlphabet } from 'nanoid'
import { sql } from '../db'
import { emptyDay, type Day } from './days'
import type { InflowwCreator } from './infloww'
import { WINBACK, type FanDay, type QuietFan } from './winback'

export const newId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12)

export type Account = {
  infloww_id: string
  name: string
  username: string
  model_id: string | null
  win_floor_cents: number | null
  first_day: string | null
  pulled_through: string | null
  pulled_at: string | null
  pull_error: string | null
  missing_since: string | null
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)

function toAccount(r: Record<string, unknown>): Account {
  return {
    infloww_id: String(r.infloww_id),
    name: String(r.name),
    username: String(r.username),
    model_id: r.model_id ? String(r.model_id) : null,
    win_floor_cents: r.win_floor_cents === null ? null : Number(r.win_floor_cents),
    first_day: iso(r.first_day),
    pulled_through: iso(r.pulled_through),
    pulled_at: r.pulled_at ? new Date(String(r.pulled_at)).toISOString() : null,
    pull_error: r.pull_error ? String(r.pull_error) : null,
    missing_since: r.missing_since ? new Date(String(r.missing_since)).toISOString() : null,
  }
}

export async function loadAccounts(): Promise<Account[]> {
  const rows = await sql.query(`select * from transcriber.earnings_accounts order by name`)
  return rows.map(toAccount)
}

/** Bring the account list in line with Infloww. Returns who vanished and who
 *  came back, for OPS. A vanished account keeps its history and stops being
 *  reported on until it returns. */
export async function syncAccounts(live: InflowwCreator[]) {
  const before = await loadAccounts()
  const liveIds = new Set(live.map((c) => c.id))
  for (const c of live) {
    await sql.query(
      `insert into transcriber.earnings_accounts (infloww_id, name, username)
         values ($1, $2, $3)
       on conflict (infloww_id) do update
         set name = excluded.name, username = excluded.username, last_seen_at = now(), missing_since = null`,
      [c.id, c.name, c.userName],
    )
  }
  const gone = before.filter((a) => !liveIds.has(a.infloww_id) && !a.missing_since)
  for (const a of gone) {
    await sql.query(`update transcriber.earnings_accounts set missing_since = now() where infloww_id = $1`, [a.infloww_id])
  }
  const back = before.filter((a) => liveIds.has(a.infloww_id) && a.missing_since)
  const added = live.filter((c) => !before.some((a) => a.infloww_id === c.id))
  return { gone, back, added }
}

/** Replace the day rows for [from, to] in one go. Days with no sales are
 *  stored as zero so a re-pull that finds a refund can bring a day down. */
export async function saveDays(id: string, from: string, to: string, days: Day[], through: string, firstDay: string, fans: FanDay[] = []) {
  // Only the window's own days: a sale stamped exactly on the next midnight
  // must not collide with a row this delete did not clear.
  const payload = JSON.stringify(days.filter((d) => d.day >= from && d.day <= to))
  await sql.transaction([
    sql.query(`delete from transcriber.earnings_days where infloww_id = $1 and day between $2 and $3`, [id, from, to]),
    sql.query(
      `insert into transcriber.earnings_days (infloww_id, day, gross, net, txns, by_type, subs, renewals, loading_net)
       select $1, r.day, r.gross, r.net, r.txns, r.by_type, r.subs, r.renewals, r.loading_net
         from jsonb_to_recordset($2::jsonb) as r(day date, gross bigint, net bigint, txns int, by_type jsonb, subs int, renewals int, loading_net bigint)`,
      [id, payload],
    ),
    sql.query(`delete from transcriber.earnings_fan_days where infloww_id = $1 and day between $2 and $3`, [id, from, to]),
    sql.query(
      `insert into transcriber.earnings_fan_days (infloww_id, fan_id, day, net, txns)
       select $1, r.fan_id, r.day, r.net, r.txns
         from jsonb_to_recordset($2::jsonb) as r(fan_id text, day date, net bigint, txns int)`,
      [id, JSON.stringify(fans.filter((f) => f.day >= from && f.day <= to))],
    ),
    sql.query(
      `update transcriber.earnings_accounts
          set pulled_through = $2, pulled_at = now(), pull_error = null,
              first_day = least(coalesce(first_day, $3::date), $3::date)
        where infloww_id = $1`,
      [id, through, firstDay],
    ),
  ])
}

export async function notePullError(id: string, error: string) {
  await sql.query(`update transcriber.earnings_accounts set pull_error = $2, pulled_at = now() where infloww_id = $1`, [id, error.slice(0, 500)])
}

const rowToDay = (r: Record<string, unknown>): Day => ({
  day: iso(r.day)!,
  gross: Number(r.gross), net: Number(r.net), txns: Number(r.txns),
  by_type: { ...emptyDay('x').by_type, ...(r.by_type as Day['by_type']) },
  subs: Number(r.subs), renewals: Number(r.renewals), loading_net: Number(r.loading_net),
})

/** Day rows for a set of accounts, summed per day — a model with a free and
 *  a VIP page is one person with one week. */
export async function combinedDays(ids: string[], from: string): Promise<Day[]> {
  if (ids.length === 0) return []
  const rows = await sql.query(
    `select day, sum(gross) gross, sum(net) net, sum(txns) txns, sum(subs) subs, sum(renewals) renewals, sum(loading_net) loading_net,
            jsonb_build_object(
              'Messages', sum((by_type->>'Messages')::bigint), 'Tips', sum((by_type->>'Tips')::bigint),
              'Subscription', sum((by_type->>'Subscription')::bigint),
              'RecurringSubscription', sum((by_type->>'RecurringSubscription')::bigint),
              'Posts', sum((by_type->>'Posts')::bigint), 'Other', sum((by_type->>'Other')::bigint)) by_type
       from transcriber.earnings_days
      where infloww_id = any($1) and day >= $2
      group by day order by day`,
    [ids, from],
  )
  return rows.map(rowToDay)
}

export type Reportable = {
  model_id: string
  model_name: string
  chat_id: string | null
  accounts: Account[]
}

/** Every model with at least one live account matched to it. */
export async function reportables(): Promise<Reportable[]> {
  // Missing accounts are kept: a model with one of them gone is skipped by
  // the job, never reported on the half that is left.
  const accounts = (await loadAccounts()).filter((a) => a.model_id)
  if (accounts.length === 0) return []
  const models = await sql.query(
    `select id, name, telegram_chat_id from transcriber.models where id = any($1) and status = 'active'`,
    [[...new Set(accounts.map((a) => a.model_id!))]],
  )
  return models.map((m) => ({
    model_id: String(m.id),
    model_name: String(m.name),
    chat_id: m.telegram_chat_id ? String(m.telegram_chat_id) : null,
    accounts: accounts.filter((a) => a.model_id === m.id),
  }))
}

/** Once-only by `key`. Returns true when this call created it. */
export async function draftMessage(m: {
  key: string; kind: 'weekly' | 'win' | 'monthly' | 'milestone'; model_id: string; chat_id: string; period: string; body: string; numbers: unknown; approved: boolean
}): Promise<boolean> {
  const rows = await sql.query(
    `insert into transcriber.earnings_messages (id, key, kind, model_id, chat_id, period, body, numbers, status, decided_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $9 = 'approved' then now() end)
     on conflict (key) do nothing returning id`,
    [newId(), m.key, m.kind, m.model_id, m.chat_id, m.period, m.body, JSON.stringify(m.numbers), m.approved ? 'approved' : 'draft'],
  )
  return rows.length > 0
}

export async function winsInWeek(modelId: string, monday: string, sunday: string): Promise<number> {
  const [row] = await sql.query(
    `select count(*)::int n from transcriber.earnings_messages
      where model_id = $1 and kind = 'win' and period between $2 and $3 and status <> 'skipped'`,
    [modelId, monday, sunday],
  )
  return Number(row?.n ?? 0)
}

export async function alert(key: string, body: string) {
  await sql.query(
    `insert into transcriber.earnings_alerts (id, key, body) values ($1, $2, $3) on conflict (key) do nothing`,
    [newId(), key, body],
  )
}

/** Fans of matched, connected accounts who spent big in the lookback and
 *  have bought nothing for `quietDays`. Fan id and money only. */
export async function quietFans(today: string): Promise<QuietFan[]> {
  const rows = await sql.query(
    `select m.name model_name, f.fan_id, sum(f.net)::bigint spent, max(f.day) last_day,
            ($1::date - max(f.day))::int quiet_days
       from transcriber.earnings_fan_days f
       join transcriber.earnings_accounts a on a.infloww_id = f.infloww_id
       join transcriber.models m on m.id = a.model_id
      where a.missing_since is null and m.status = 'active'
        -- Only accounts pulled cleanly today through yesterday: a fan who
        -- bought during days a failed pull missed must not look quiet.
        and a.pull_error is null and a.pulled_through >= $1::date - 1
        and (a.pulled_at at time zone 'America/New_York')::date = $1::date
        and f.day >= $1::date - $2::int
      group by m.name, f.infloww_id, f.fan_id
     having sum(f.net) >= $3 and max(f.day) <= $1::date - $4::int`,
    [today, WINBACK.lookbackDays, WINBACK.minCents, WINBACK.quietDays],
  )
  return rows.map((r) => ({
    model_name: String(r.model_name), fan_id: String(r.fan_id), spent: Number(r.spent),
    last_day: iso(r.last_day)!, quiet_days: Number(r.quiet_days),
  }))
}

/** Milestone codes already drafted for her this month (skipped ones count:
 *  Geno said no to that moment, not to a later repeat of it). */
export async function milestoneCodes(modelId: string, month: string, monthEnd: string): Promise<Set<string>> {
  const rows = await sql.query(
    `select numbers from transcriber.earnings_messages
      where model_id = $1 and kind = 'milestone' and period between $2 and $3`,
    [modelId, month, monthEnd],
  )
  return new Set(rows.flatMap((r) => ((r.numbers as { codes?: string[] })?.codes ?? [])))
}
