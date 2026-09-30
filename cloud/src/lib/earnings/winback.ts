/**
 * Big spenders gone quiet — the Monday win-back list for OPS (2026-09-30).
 *
 * Geno's call: a weekly post in GOSIAN | OPS only, fan IDs only. No fan name
 * is ever read, stored or shown (chatters write notes in names), and nothing
 * here goes near a creator. The chat link opens the fan in OnlyFans for
 * whoever is logged in as that creator, where the chatter sees the rest.
 *
 *   big      ≥ $500 net from her in the last 90 days
 *   quiet    nothing in the last 14 days
 *   tiers    $2K+, $1K–2K, $500–1K; sorted by spend
 *   size     at most 5 per creator, 30 in all, so it stays a list people act on
 */
import { dayOf, type RawTxn } from './days'
import { money } from './report'

export const WINBACK = {
  lookbackDays: 90,
  quietDays: 14,
  minCents: 50_000,
  perCreator: 5,
  total: 30,
} as const

const DROPPED = new Set(['undo', 'pending_return'])

export type FanDay = { fan_id: string; day: string; net: number; txns: number }

/** Net per fan per New York day. Refunds dropped; a sale with no fan id is
 *  left out rather than pooled under a blank one. Pure. */
export function foldFans(txns: RawTxn[]): FanDay[] {
  const acc = new Map<string, FanDay>()
  for (const t of txns) {
    if (DROPPED.has(t.status) || !t.fanId) continue
    const ms = typeof t.createdTime === 'number' ? t.createdTime : parseInt(t.createdTime, 10)
    if (!Number.isFinite(ms) || !ms) continue
    const day = dayOf(ms)
    const key = `${t.fanId}|${day}`
    const net = typeof t.net === 'number' ? t.net : parseInt(t.net, 10) || 0
    const prev = acc.get(key)
    acc.set(key, prev ? { ...prev, net: prev.net + net, txns: prev.txns + 1 } : { fan_id: t.fanId, day, net, txns: 1 })
  }
  return [...acc.values()]
}

export type QuietFan = {
  model_name: string
  fan_id: string
  spent: number // cents over the lookback
  last_day: string
  quiet_days: number
}

export const tierOf = (cents: number) => (cents >= 200_000 ? '$2K+' : cents >= 100_000 ? '$1K–2K' : '$500–1K')

/** Keep the list short enough to act on: best spenders first, capped per
 *  creator and overall. Input order does not matter. */
export function pickQuiet(fans: QuietFan[]): QuietFan[] {
  const sorted = [...fans].sort((a, b) => b.spent - a.spent)
  const per = new Map<string, number>()
  const out: QuietFan[] = []
  for (const f of sorted) {
    const n = per.get(f.model_name) ?? 0
    if (n >= WINBACK.perCreator) continue
    per.set(f.model_name, n + 1)
    out.push(f)
    if (out.length >= WINBACK.total) break
  }
  return out
}

/** The OPS post. Grouped by creator, biggest spenders first. */
export function winbackText(fans: QuietFan[], monday: string): string | null {
  if (fans.length === 0) return null
  const byModel = new Map<string, QuietFan[]>()
  for (const f of fans) byModel.set(f.model_name, [...(byModel.get(f.model_name) ?? []), f])
  const order = [...byModel.entries()].sort((a, b) => b[1][0].spent - a[1][0].spent)
  const lines = [
    `💸 Win-back list, week of ${monday}`,
    `Fans who spent ${money(WINBACK.minCents)}+ in the last ${WINBACK.lookbackDays} days and have gone quiet ${WINBACK.quietDays}+ days. Open the chat logged in as that creator.`,
  ]
  for (const [name, list] of order) {
    lines.push('', `${name}`)
    for (const f of list) {
      lines.push(`• ${tierOf(f.spent)} · ${money(f.spent)} · quiet ${f.quiet_days}d · fan ${f.fan_id} · https://onlyfans.com/my/chats/chat/${f.fan_id}`)
    }
  }
  lines.push('', 'Internal only. Never forward this to a creator.')
  return lines.join('\n')
}
