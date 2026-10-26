/**
 * What a creator is told about her own money, and when (2026-09-30).
 *
 * Every number here is computed from stored day rows; the words around them
 * are fixed templates picked by the numbers (Geno: templates, not a model).
 * Nothing here knows a fan exists.
 *
 *   weekly   Mon–Sun just ended vs the Mon–Sun before (same seven days both
 *            sides), best day, where the money came from, new subs and
 *            renewals, and this week against the four weeks before it.
 *   win      yesterday at ≥ 1.5× her trailing 28-day median day and over a
 *            floor ($150 net by default), or her best day in 30 / 90 days.
 *            At most two a week, so they stay special.
 *   drops    a week or a day down more than 25% goes to OPS only, never to her.
 *
 * All amounts are net: after OnlyFans' 20% fee, and labelled so.
 */
import { addDays, daysBetween, emptyDay, type Day, type TxnType } from './days'

export const RULES = {
  winMultiple: 1.5,
  winFloorCents: 15_000,
  medianDays: 28,
  winsPerWeek: 2,
  dropShare: 0.25,
  /** A day-over-day drop is only worth an OPS line when the day before was
   *  real money; $40 → $20 is noise, and 31 accounts of noise buries the rest. */
  dayDropFloorCents: 10_000,
  /** Above this share of unsettled money, a win says it may still move. */
  provisionalShare: 0.5,
} as const

/** Fill the gaps: a day with no sales is a $0 day, not a missing one. */
export function dense(rows: Day[], from: string, to: string): Day[] {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  return daysBetween(from, to).map((d) => byDay.get(d) ?? emptyDay(d))
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const sum = (days: Day[], pick: (d: Day) => number) => days.reduce((n, d) => n + pick(d), 0)

/** Percent change, or null when there is nothing to compare against. */
export function change(now: number, before: number): number | null {
  if (before <= 0) return null
  return Math.round(((now - before) / before) * 100)
}

// ------------------------------------------------------------------ weekly

export type WeeklyNumbers = {
  from: string
  to: string
  net: number
  prevNet: number
  change: number | null
  best: { day: string; net: number } | null
  split: { type: TxnType; share: number }[]
  subs: number
  renewals: number
  avg4: number | null
  vsAvg4: number | null
  provisional: boolean
  /** True only when we hold no week before this one — not when that week was $0. */
  first: boolean
  /** Down more than 25% on the week before: an OPS line, never hers. */
  dropAlert: boolean
}

/** `monday` is the first day of the week being reported. `history` must
 *  cover the four weeks before it as well. */
export function weeklyNumbers(history: Day[], monday: string, historyStart: string): WeeklyNumbers {
  const sunday = addDays(monday, 6)
  const week = dense(history, monday, sunday)
  const prev = dense(history, addDays(monday, -7), addDays(monday, -1))
  const net = sum(week, (d) => d.net)
  const prevNet = sum(prev, (d) => d.net)

  const bestDay = week.reduce<Day | null>((b, d) => (d.net > 0 && (!b || d.net > b.net) ? d : b), null)

  const types: TxnType[] = ['Messages', 'Tips', 'Subscription', 'RecurringSubscription', 'Posts']
  const split = net > 0
    ? types
        .map((type) => ({ type, share: Math.round((sum(week, (d) => d.by_type[type]) / net) * 100) }))
        .filter((s) => s.share > 0)
        .sort((a, b) => b.share - a.share)
    : []

  // Four whole weeks before this one, only if we hold all of them — a
  // part-covered average would compare her week to days we never pulled.
  const fourStart = addDays(monday, -28)
  const haveFour = historyStart <= fourStart
  const avg4 = haveFour ? Math.round(sum(dense(history, fourStart, addDays(monday, -1)), (d) => d.net) / 4) : null

  return {
    from: monday,
    to: sunday,
    net,
    prevNet,
    change: historyStart <= addDays(monday, -7) ? change(net, prevNet) : null,
    best: bestDay ? { day: bestDay.day, net: bestDay.net } : null,
    split,
    subs: sum(week, (d) => d.subs),
    renewals: sum(week, (d) => d.renewals),
    avg4,
    vsAvg4: avg4 === null ? null : change(net, avg4),
    provisional: net > 0 && sum(week, (d) => d.loading_net) / net > RULES.provisionalShare,
    first: historyStart > addDays(monday, -7),
    dropAlert: prevNet > 0 && net < prevNet * (1 - RULES.dropShare),
  }
}

// --------------------------------------------------------------------- win

export type WinKind = 'good' | 'best30' | 'best90'
export type Win = {
  kind: WinKind
  day: string
  net: number
  usual: number // her 28-day median day, cents
  multiple: number | null
  provisional: boolean
}

/**
 * Was `day` a win? `history` is every stored day for her; `historyStart` the
 * first day we hold, so "best in 90 days" is never claimed on 12 days of data.
 */
export function winFor(history: Day[], day: string, historyStart: string, floorCents: number = RULES.winFloorCents): Win | null {
  const today = history.find((d) => d.day === day) ?? emptyDay(day)
  if (today.net < floorCents) return null

  const before = (n: number) => dense(history, addDays(day, -n), addDays(day, -1))
  const held = (n: number) => historyStart <= addDays(day, -n)
  const beats = (days: Day[]) => days.every((d) => today.net > d.net)

  const usual = held(RULES.medianDays) ? median(before(RULES.medianDays).map((d) => d.net)) : 0
  const multiple = usual > 0 ? Math.round((today.net / usual) * 10) / 10 : null
  const provisional = today.loading_net / today.net > RULES.provisionalShare
  const base = { day, net: today.net, usual, multiple, provisional }

  if (held(89) && beats(before(89))) return { kind: 'best90', ...base }
  if (held(29) && beats(before(29))) return { kind: 'best30', ...base }
  if (usual > 0 && today.net >= usual * RULES.winMultiple) return { kind: 'good', ...base }
  return null
}

/** Day-over-day drop worth telling OPS about. */
export function dayDrop(history: Day[], day: string): { net: number; prevNet: number; change: number } | null {
  const [prev, today] = dense(history, addDays(day, -1), day)
  if (prev.net < RULES.dayDropFloorCents) return null
  if (today.net >= prev.net * (1 - RULES.dropShare)) return null
  return { net: today.net, prevNet: prev.net, change: change(today.net, prev.net) ?? -100 }
}

// ----------------------------------------------------------------- wording

export function money(c: number): string {
  const dollars = c / 100
  return dollars >= 100
    ? `$${Math.round(dollars).toLocaleString('en-US')}`
    : `$${dollars.toFixed(2)}`
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const asDate = (day: string) => new Date(`${day}T12:00:00Z`)
export const niceDay = (day: string) => WEEKDAY.format(asDate(day))
export const shortDay = (day: string) => SHORT.format(asDate(day))

const TYPE_WORD: Record<TxnType, string> = {
  Messages: 'Messages', Tips: 'Tips', Subscription: 'New subs', RecurringSubscription: 'Renewals', Posts: 'Posts',
}

/** Stable pick: the same week always gets the same line, so a re-drafted
 *  report never reads differently from the one Geno approved. */
function pick<T>(options: readonly T[], seed: string): T {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return options[h % options.length]
}

const LINES = {
  up: [
    'That is real momentum. Keep doing what you did this week. 🙌',
    'Up on last week. Whatever you changed, it is working. 💪',
    'A stronger week than the last one. Love to see it. ✨',
  ],
  steady: [
    'A steady week. Consistency is what builds the big months. 🌱',
    'Right in line with last week. Solid and reliable. 👏',
  ],
  down: [
    'A quieter week. They come and go, and next week is a fresh start.',
    'Lower than last week. One good week turns it right back around.',
  ],
  first: [
    'Your first weekly report. From here on you will see how each week compares. ✨',
  ],
} as const

function toneOf(n: WeeklyNumbers): keyof typeof LINES {
  if (n.first) return 'first'
  if (n.change === null) return n.net > 0 ? 'up' : 'steady'
  if (n.change >= 5) return 'up'
  if (n.change <= -5) return 'down'
  return 'steady'
}

/** The Monday message. `{name}` is filled by the bot from her group. */
export function weeklyText(n: WeeklyNumbers, seed: string): string {
  const lines: string[] = [`📊 Your week, {name} (${shortDay(n.from)} – ${shortDay(n.to)})`, '']
  const vs = n.change === null ? '' : n.change === 0 ? ', same as last week' : n.change > 0 ? `, up ${n.change}% on last week` : `, down ${Math.abs(n.change)}% on last week`
  lines.push(`💰 Net earnings: ${money(n.net)}${vs}`)
  if (n.best) lines.push(`⭐ Best day: ${niceDay(n.best.day)}, ${money(n.best.net)}`)
  if (n.split.length) lines.push(`🧾 Where it came from: ${n.split.map((s) => `${TYPE_WORD[s.type]} ${s.share}%`).join(' · ')}`)
  lines.push(`👥 New subs ${n.subs} · Renewals ${n.renewals}`)
  if (n.vsAvg4 !== null) {
    const word = n.vsAvg4 === 0 ? 'right on' : n.vsAvg4 > 0 ? `${n.vsAvg4}% above` : `${Math.abs(n.vsAvg4)}% below`
    lines.push(`📈 ${word[0].toUpperCase()}${word.slice(1)} your 4-week average`)
  }
  lines.push('', pick(LINES[toneOf(n)], seed))
  return lines.join('\n')
}

export function winText(w: Win, seed: string): string {
  const head = w.kind === 'best90'
    ? `🏆 Congrats {name}! ${niceDay(w.day)} was your best day in 90 days.`
    : w.kind === 'best30'
      ? `🎉 Congrats {name}! ${niceDay(w.day)} was your best day in 30 days.`
      : pick([`🔥 Hey {name}, you had a great day on ${niceDay(w.day)}!`, `✨ {name}, ${niceDay(w.day)} was a great day!`], seed)
  const vs = w.multiple !== null && w.multiple >= 1.2
    ? ` That is ${w.multiple}× your usual day (${money(w.usual)}).`
    : ''
  const lines = [head, '', `💰 ${money(w.net)} net.${vs}`]
  if (w.provisional) lines.push('', 'Some of it is still settling with OnlyFans, so the final figure may move a little.')
  return lines.join('\n')
}
