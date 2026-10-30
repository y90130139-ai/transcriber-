/**
 * The monthly recap and milestones — creator-facing, net, fixed templates
 * (2026-09-30). Drafted like the win notes: OPS approves, the bot delivers.
 *
 *   recap      on the 1st, the month just ended: net vs the month before,
 *              best week, where the money came from, subs, a run of weeks
 *              above her average, and whether it was her best month on record.
 *   milestone  the morning after it happens: she beat her best month, passed a
 *              round figure no earlier month reached, or a new-subs count none
 *              did. "On record" means months we hold in full — never claimed
 *              on fewer than two.
 */
import { addDays, daysBetween, type Day, type TxnType } from './days'
import { change, dense, money, shortDay } from './report'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1]

export const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`
export function lastOfMonth(day: string): string {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1)
}
const prevMonth = (day: string) => firstOfMonth(addDays(firstOfMonth(day), -1))

const MIN_RECORD_MONTHS = 2
const ROUND_DOLLARS = [1_000, 2_500, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000, 75_000, 100_000]
const SUB_COUNTS = [100, 250, 500, 1_000, 2_500]

const sum = (days: Day[], pick: (d: Day) => number) => days.reduce((n, d) => n + pick(d), 0)

/** Every full month we hold before `month` (YYYY-MM-01), with its totals. */
function heldMonths(history: Day[], month: string, historyStart: string) {
  const out: { month: string; net: number; subs: number }[] = []
  for (let m = prevMonth(month); m >= historyStart; m = prevMonth(m)) {
    const days = dense(history, m, lastOfMonth(m))
    out.push({ month: m, net: sum(days, (d) => d.net), subs: sum(days, (d) => d.subs) })
  }
  return out
}

// ---------------------------------------------------------------- recap

export type Recap = {
  month: string
  net: number
  prevNet: number | null
  change: number | null
  bestWeek: { from: string; to: string; net: number } | null
  split: { type: TxnType; share: number }[]
  subs: number
  renewals: number
  streak: number
  record: boolean
  provisional: boolean
}

/** Consecutive Mon–Sun weeks, newest first, ending on or before `end`, each
 *  at or above the average of the four weeks before it. */
function weeksAboveAverage(history: Day[], end: string, historyStart: string): number {
  const weekday = new Date(`${end}T12:00:00Z`).getUTCDay()
  let sunday = weekday === 0 ? end : addDays(end, -weekday)
  let streak = 0
  for (;;) {
    const monday = addDays(sunday, -6)
    if (addDays(monday, -28) < historyStart) break
    const week = sum(dense(history, monday, sunday), (d) => d.net)
    const avg = sum(dense(history, addDays(monday, -28), addDays(monday, -1)), (d) => d.net) / 4
    if (avg <= 0 || week < avg) break
    streak++
    sunday = addDays(sunday, -7)
  }
  return streak
}

export function recapFor(history: Day[], month: string, historyStart: string): Recap {
  const end = lastOfMonth(month)
  const days = dense(history, month, end)
  const net = sum(days, (d) => d.net)
  const prior = heldMonths(history, month, historyStart)
  const prevNet = prior[0]?.month === prevMonth(month) ? prior[0].net : null

  let bestWeek: Recap['bestWeek'] = null
  for (const d of daysBetween(month, end)) {
    if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1 || addDays(d, 6) > end) continue
    const weekNet = sum(dense(history, d, addDays(d, 6)), (x) => x.net)
    if (weekNet > 0 && (!bestWeek || weekNet > bestWeek.net)) bestWeek = { from: d, to: addDays(d, 6), net: weekNet }
  }

  const types: TxnType[] = ['Messages', 'Tips', 'Subscription', 'RecurringSubscription', 'Posts']
  const split = net > 0
    ? types.map((type) => ({ type, share: Math.round((sum(days, (d) => d.by_type[type]) / net) * 100) }))
        .filter((s) => s.share > 0).sort((a, b) => b.share - a.share)
    : []

  return {
    month, net, prevNet,
    change: prevNet === null ? null : change(net, prevNet),
    bestWeek, split,
    subs: sum(days, (d) => d.subs),
    renewals: sum(days, (d) => d.renewals),
    streak: weeksAboveAverage(history, end, historyStart),
    record: prior.length >= MIN_RECORD_MONTHS && net > 0 && prior.every((p) => net > p.net),
    provisional: net > 0 && sum(days, (d) => d.loading_net) / net > 0.1,
  }
}

const TYPE_WORD: Record<TxnType, string> = {
  Messages: 'Messages', Tips: 'Tips', Subscription: 'New subs', RecurringSubscription: 'Renewals', Posts: 'Posts',
}

export function recapText(r: Recap): string {
  const lines = [`🗓 Your ${monthName(r.month)}, {name}`, '']
  const vs = r.change === null ? '' : r.change === 0 ? `, level with ${monthName(prevMonth(r.month))}` : r.change > 0 ? `, up ${r.change}% on ${monthName(prevMonth(r.month))}` : `, down ${Math.abs(r.change)}% on ${monthName(prevMonth(r.month))}`
  lines.push(`💰 ${money(r.net)}${vs}`)
  if (r.bestWeek) lines.push(`⭐ Best week: ${shortDay(r.bestWeek.from)} – ${shortDay(r.bestWeek.to)}, ${money(r.bestWeek.net)}`)
  if (r.split.length) lines.push(`🧾 ${r.split.map((s) => `${TYPE_WORD[s.type]} ${s.share}%`).join(' · ')}`)
  lines.push(`👥 ${r.subs} new subs · ${r.renewals} renewals`)
  if (r.streak >= 2) lines.push(`🔥 ${r.streak} weeks in a row above your average`)
  if (r.record) lines.push('', `🏅 Your best month on record!`)
  lines.push('', r.change !== null && r.change < 0
    ? 'On to the next one. A new month is a fresh start. 🌱'
    : 'Thank you for a great month. Let’s make the next one even better. ✨')
  return lines.join('\n')
}

// ------------------------------------------------------------ milestones

export type MilestoneCode = `record` | `round:${number}` | `subs:${number}`
export type Milestone = { code: MilestoneCode; line: string }

/**
 * What she crossed on `day` (yesterday), month to date. `already` holds the
 * codes sent earlier this month, so a re-pull that nudges a total back over a
 * line never celebrates it twice.
 */
export function milestonesFor(history: Day[], day: string, historyStart: string, already: ReadonlySet<string> = new Set()): Milestone[] {
  const month = firstOfMonth(day)
  const prior = heldMonths(history, month, historyStart)
  if (prior.length < MIN_RECORD_MONTHS) return []
  const mtd = dense(history, month, day)
  const net = sum(mtd, (d) => d.net)
  const netBefore = net - (mtd.at(-1)?.net ?? 0)
  const subs = sum(mtd, (d) => d.subs)
  const subsBefore = subs - (mtd.at(-1)?.subs ?? 0)
  const best = Math.max(...prior.map((p) => p.net))
  const bestSubs = Math.max(...prior.map((p) => p.subs))
  const left = Number(lastOfMonth(day).slice(8)) - Number(day.slice(8))
  const out: Milestone[] = []

  if (best > 0 && net > best && netBefore <= best && !already.has('record')) {
    out.push({ code: 'record', line: `🏆 You just beat your best month on record: ${money(net)} so far in ${monthName(month)}${left > 0 ? `, with ${left} day${left === 1 ? '' : 's'} still to go` : ''}!` })
  }
  // Only the highest round figure crossed in one day: "$1K" and "$2.5K" in
  // the same message reads like a counting error.
  const round = ROUND_DOLLARS
    .filter((dollars) => netBefore < dollars * 100 && net >= dollars * 100 && dollars * 100 > best && !already.has(`round:${dollars}`))
    .at(-1)
  if (round) out.push({ code: `round:${round}`, line: `🏅 ${money(round * 100)} this month, a first for you!` })
  for (const count of SUB_COUNTS) {
    const code = `subs:${count}` as const
    if (subsBefore < count && subs >= count && count > bestSubs && !already.has(code)) {
      out.push({ code, line: `👥 ${count} new subs this month, more than any month before!` })
    }
  }
  return out
}

export function milestoneText(ms: Milestone[]): string {
  return [`🎉 Milestone, {name}!`, '', ...ms.map((m) => m.line)].join('\n')
}
