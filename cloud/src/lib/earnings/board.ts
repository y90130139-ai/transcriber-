/**
 * Earnings as the console shows them: the agency, each account, each model.
 * Read-only views over the day rows. Internal only — gross and net both.
 */
import { sql } from '../db'
import { addDays, dayOf } from './days'
import { dense, change, weeklyNumbers } from './report'
import { combinedDays, loadAccounts, type Account } from './store'

export const EARNINGS_WINDOWS = [7, 30, 90] as const
export type EarningsWindow = (typeof EARNINGS_WINDOWS)[number]

export type AccountRow = Account & {
  model_name: string | null
  net: number
  gross: number
  prevNet: number
  change: number | null
  share: number // of agency net in the window, percent
}

export async function loadEarningsBoard(days: EarningsWindow) {
  const today = dayOf(Date.now())
  const to = addDays(today, -1) // yesterday: today is still coming in
  const from = addDays(to, -(days - 1))
  const prevFrom = addDays(from, -days)

  const [accounts, sums, series, models, messages] = await Promise.all([
    loadAccounts(),
    sql.query(
      `select infloww_id,
              sum(net) filter (where day between $1 and $2) net,
              sum(gross) filter (where day between $1 and $2) gross,
              sum(net) filter (where day between $3 and $4) prev_net
         from transcriber.earnings_days where day between $3 and $2 group by infloww_id`,
      [from, to, prevFrom, addDays(from, -1)],
    ),
    sql.query(
      `select day, sum(net) net, sum(gross) gross from transcriber.earnings_days
        where day between $1 and $2 group by day order by day`,
      [from, to],
    ),
    sql.query(`select id, name from transcriber.models where status = 'active' order by name`),
    sql.query(
      `select e.id, e.kind, e.status, e.period, e.created_at, e.error, m.name model_name
         from transcriber.earnings_messages e join transcriber.models m on m.id = e.model_id
        order by e.created_at desc limit 30`,
    ),
  ])

  const byId = new Map(sums.map((s) => [String(s.infloww_id), s]))
  const names = new Map(models.map((m) => [String(m.id), String(m.name)]))
  const total = sums.reduce((n, s) => n + Number(s.net ?? 0), 0)
  const totalPrev = sums.reduce((n, s) => n + Number(s.prev_net ?? 0), 0)

  const rows: AccountRow[] = accounts
    .map((a) => {
      const s = byId.get(a.infloww_id)
      const net = Number(s?.net ?? 0)
      const prevNet = Number(s?.prev_net ?? 0)
      return {
        ...a,
        model_name: a.model_id ? names.get(a.model_id) ?? null : null,
        net, gross: Number(s?.gross ?? 0), prevNet,
        change: change(net, prevNet),
        share: total > 0 ? Math.round((net / total) * 1000) / 10 : 0,
      }
    })
    .sort((x, y) => y.net - x.net)

  const byDay = new Map(series.map((r) => [String(r.day instanceof Date ? r.day.toISOString() : r.day).slice(0, 10), r]))
  return {
    window: { from, to, days },
    total: { net: total, gross: rows.reduce((n, r) => n + r.gross, 0), prevNet: totalPrev, change: change(total, totalPrev) },
    daily: dense([], from, to).map((d) => ({ day: d.day, net: Number(byDay.get(d.day)?.net ?? 0) })),
    accounts: rows,
    models: models.map((m) => ({ id: String(m.id), name: String(m.name) })),
    messages: messages.map((m) => ({
      id: String(m.id), kind: String(m.kind), status: String(m.status), model_name: String(m.model_name),
      period: String(m.period instanceof Date ? m.period.toISOString() : m.period).slice(0, 10),
      error: m.error ? String(m.error) : null,
    })),
    pulledAt: accounts.map((a) => a.pulled_at).filter(Boolean).sort().at(-1) ?? null,
  }
}

/** One model, all her accounts together: daily net and her last full week. */
export async function loadModelEarnings(modelId: string, days: EarningsWindow) {
  const accounts = (await loadAccounts()).filter((a) => a.model_id === modelId)
  const today = dayOf(Date.now())
  const to = addDays(today, -1)
  const from = addDays(to, -(days - 1))
  if (accounts.length === 0) return { accounts: [], daily: [], week: null, window: { from, to, days } }

  const history = await combinedDays(accounts.map((a) => a.infloww_id), addDays(today, -120))
  const historyStart = accounts.map((a) => a.first_day ?? today).sort().at(-1)!
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const lastMonday = addDays(today, -((weekday + 6) % 7) - 7)
  return {
    accounts: accounts.map((a) => ({ infloww_id: a.infloww_id, name: a.name, username: a.username, missing_since: a.missing_since })),
    daily: dense(history, from, to).map((d) => ({ day: d.day, net: d.net, gross: d.gross, by_type: d.by_type, subs: d.subs, renewals: d.renewals })),
    week: historyStart <= lastMonday ? weeklyNumbers(history, lastMonday, historyStart) : null,
    window: { from, to, days },
  }
}

/** Changing which model an account belongs to voids every unsent message for
 *  the model it left and the one it joined: those were drafted on the old
 *  mapping and may carry the other creator's money. */
export async function matchAccount(id: string, modelId: string | null, floorCents: number | null) {
  const [before] = await sql.query(`select model_id from transcriber.earnings_accounts where infloww_id = $1`, [id])
  if (!before) return false
  const moved = (before.model_id ?? null) !== modelId
  await sql.transaction([
    sql.query(`update transcriber.earnings_accounts set model_id = $2, win_floor_cents = $3 where infloww_id = $1`, [id, modelId, floorCents]),
    sql.query(
      `update transcriber.earnings_messages set status = 'failed', error = 'an Infloww account was re-matched after this was drafted'
        where $3 and status in ('draft', 'approved') and model_id = any($1::text[] || $2::text[])`,
      [before.model_id ? [before.model_id] : [], modelId ? [modelId] : [], moved],
    ),
  ])
  return true
}
