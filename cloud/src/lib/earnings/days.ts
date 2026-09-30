/**
 * Infloww transactions → one row per creator per day (2026-09-30).
 *
 * The only shape earnings are stored in. A day row carries money and counts
 * and nothing else: no fan id, no fan name, no chatter note ever leaves this
 * function, so nothing fan-level can reach the database, the dashboard or a
 * creator's group (Geno: creator-level only).
 *
 * Days are reckoned in New York, the agency's clock. Reversed money
 * (`undo`, `pending_return`) is dropped; `loading` money counts but is also
 * tallied on its own, because OnlyFans has not settled it yet and a win that
 * rests mostly on it has to say so.
 */

export const EARNINGS_ZONE = 'America/New_York'

export const TYPES = ['Messages', 'Tips', 'Subscription', 'RecurringSubscription', 'Posts'] as const
export type TxnType = (typeof TYPES)[number]

const DROPPED = new Set(['undo', 'pending_return'])

/** What arrives from `/v1/transactions`. Only these fields are read. */
export type RawTxn = {
  createdTime: string | number
  type: string
  status: string
  amount: string | number
  net: string | number
}

export type Day = {
  day: string // YYYY-MM-DD in New York
  gross: number // cents
  net: number // cents
  txns: number
  by_type: Record<TxnType | 'Other', number> // net cents
  subs: number
  renewals: number
  loading_net: number // cents still unsettled
}

const cents = (value: string | number): number => {
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: EARNINGS_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** The New York calendar date of an instant. */
export function dayOf(ms: number): string {
  return DAY_FMT.format(new Date(ms))
}

export function emptyDay(day: string): Day {
  return {
    day, gross: 0, net: 0, txns: 0,
    by_type: { Messages: 0, Tips: 0, Subscription: 0, RecurringSubscription: 0, Posts: 0, Other: 0 },
    subs: 0, renewals: 0, loading_net: 0,
  }
}

/** Fold transactions into day rows. Pure; the input is not touched. */
export function foldDays(txns: RawTxn[]): Day[] {
  const byDay = new Map<string, Day>()
  for (const t of txns) {
    if (DROPPED.has(t.status)) continue
    const ms = cents(t.createdTime)
    if (!ms) continue
    const key = dayOf(ms)
    const prev = byDay.get(key) ?? emptyDay(key)
    const net = cents(t.net)
    const type: TxnType | 'Other' = (TYPES as readonly string[]).includes(t.type) ? (t.type as TxnType) : 'Other'
    byDay.set(key, {
      ...prev,
      gross: prev.gross + cents(t.amount),
      net: prev.net + net,
      txns: prev.txns + 1,
      by_type: { ...prev.by_type, [type]: prev.by_type[type] + net },
      subs: prev.subs + (type === 'Subscription' ? 1 : 0),
      renewals: prev.renewals + (type === 'RecurringSubscription' ? 1 : 0),
      loading_net: prev.loading_net + (t.status === 'loading' ? net : 0),
    })
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/** Every calendar day from `from` to `to` inclusive (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  let at = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  while (at <= end) {
    out.push(new Date(at).toISOString().slice(0, 10))
    at += 86_400_000
  }
  return out
}

export function addDays(day: string, n: number): string {
  const at = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86_400_000
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * The instant a New York calendar day starts, in ms. Found by probing the two
 * possible offsets (EST −5, EDT −4) rather than trusting a fixed one, so the
 * window is right on both sides of a clock change.
 */
export function startOfDay(day: string): number {
  const midnightUtc = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))
  for (const hours of [4, 5]) {
    const guess = midnightUtc + hours * 3_600_000
    if (dayOf(guess) === day && dayOf(guess - 1) !== day) return guess
  }
  return midnightUtc + 5 * 3_600_000
}
