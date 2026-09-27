/**
 * Infloww (and OnlyFans statement) CSV exports → days or link rows.
 *
 * Column names are matched loosely — lowercased, punctuation dropped — against
 * the labels Infloww's help center documents for Creator Reports and the
 * tracking / free-trial link tables. We have not seen a live export yet, so
 * every column that did not match is returned in `ignored` and shown on the
 * review screen. Nothing is dropped silently; add an alias here when a real
 * export shows a new spelling.
 *
 * Pure. Tested in test/numbers.test.ts.
 */
import type { Day, DayMetric, Link } from './metrics'

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const DAY_ALIASES: Record<DayMetric, string[]> = {
  visitors: ['profile visitors', 'visitors', 'profile visits', 'visits'],
  guests: ['guests', 'guest visitors'],
  users: ['users', 'user visitors'],
  new_subs: ['new subscribers', 'new subs', 'new subscriptions', 'subscribers new'],
  renewals: ['subscriber renewals', 'renewals', 'renews', 'renewed'],
  spenders: ['spenders', 'paying fans'],
  earn_total: ['total earnings', 'earnings', 'total', 'net earnings', 'net', 'total net'],
  earn_subs: ['subscription', 'subscriptions', 'new subscription', 'subscription earnings', 'new subscription earnings'],
  earn_recurring: ['recurring subscription', 'recurring subscriptions', 'recurring', 'renewal earnings'],
  earn_tips: ['tips', 'tip earnings'],
  earn_messages: ['messages', 'message earnings', 'ppv', 'ppv earnings', 'paid messages'],
  earn_posts: ['posts', 'post earnings', 'paid posts'],
  earn_streams: ['streams', 'stream earnings'],
  earn_referrals: ['referrals', 'referral earnings'],
  refunds: ['refunds', 'refund', 'chargebacks'],
  active_fans: ['active fans', 'active subscribers'],
  renew_on: ['renew on', 'renew on count', 'renewon'],
  expired_change: ['change in expired fan count', 'change in expired fans', 'expired fans change', 'expired fan count change'],
}

type LinkField = 'name' | 'source' | 'clicks' | 'subs' | 'earnings' | 'spenders' | 'cost'
const LINK_ALIASES: Record<LinkField, string[]> = {
  name: ['name', 'link name', 'tracking link', 'link', 'campaign', 'campaign name', 'trial link', 'free trial link'],
  source: ['source', 'tag', 'traffic source'],
  clicks: ['clicks', 'link clicks'],
  subs: ['subs', 'subscribers', 'claims', 'claimed', 'fans acquired'],
  earnings: ['earnings', 'revenue', 'net earnings', 'total earnings'],
  spenders: ['spenders'],
  cost: ['promo cost', 'cost', 'spend'],
}

const DATE_ALIASES = ['date', 'day', 'date utc', 'period']

/** RFC-4180-ish: quoted fields, doubled quotes, commas or semicolons or tabs. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const first = clean.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

/** "$1,234.56" → 1234.56; "—", "", "n/a" → undefined. Percent cells are refused: we import counts and money, and derive rates ourselves. */
export function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const s = raw.trim()
  if (!s || /^(—|-|–|n\/?a|null)$/i.test(s) || s.endsWith('%')) return undefined
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-')
  const digits = s.replace(/[^0-9.]/g, '')
  if (!digits || digits === '.') return undefined
  const value = Number(digits)
  if (!Number.isFinite(value)) return undefined
  return negative ? -value : value
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** ISO, US m/d/y, or "Sep 1, 2026" → YYYY-MM-DD. Anything else → null. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  const pad = (n: number) => String(n).padStart(2, '0')
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return `${year}-${pad(+m[1])}-${pad(+m[2])}`
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase())
    if (month >= 0) return `${m[3]}-${pad(month + 1)}-${pad(+m[2])}`
  }
  return null
}

function matchHeaders<K extends string>(headers: string[], aliases: Record<K, string[]>) {
  const found = new Map<number, K>()
  const taken = new Set<K>()
  // Exact alias matches first, in alias order, so "total earnings" beats "total".
  headers.forEach((header, index) => {
    const h = norm(header)
    for (const key of Object.keys(aliases) as K[]) {
      if (!taken.has(key) && aliases[key].includes(h)) { found.set(index, key); taken.add(key); return }
    }
  })
  return found
}

export type CsvResult = {
  kind: 'days' | 'links' | 'unknown'
  days: Day[]
  links: Link[]
  mapped: Record<string, string>
  ignored: string[]
}

export function readExport(text: string, linkKind: Link['kind'] = 'tracking'): CsvResult {
  const rows = parseCsv(text)
  const empty: CsvResult = { kind: 'unknown', days: [], links: [], mapped: {}, ignored: [] }
  if (rows.length < 2) return empty
  const headers = rows[0].map((h) => h.trim())
  const dateIndex = headers.findIndex((h) => DATE_ALIASES.includes(norm(h)))
  const dayCols = matchHeaders(headers, DAY_ALIASES)
  const linkCols = matchHeaders(headers, LINK_ALIASES)
  const hasLinkShape = [...linkCols.values()].includes('clicks') && [...linkCols.values()].includes('subs')

  if (dateIndex >= 0 && dayCols.size && !hasLinkShape) {
    const days: Day[] = []
    for (const row of rows.slice(1)) {
      const day = parseDate(row[dateIndex])
      if (!day) continue // totals and footer rows
      const entry: Day = { day }
      for (const [index, metric] of dayCols) {
        const value = parseNumber(row[index])
        if (value !== undefined) entry[metric] = value
      }
      days.push(entry)
    }
    return {
      kind: 'days', days, links: [],
      mapped: Object.fromEntries([...dayCols].map(([i, k]) => [headers[i], k])),
      ignored: headers.filter((_, i) => i !== dateIndex && !dayCols.has(i)),
    }
  }

  if (hasLinkShape) {
    const nameIndex = [...linkCols].find(([, k]) => k === 'name')?.[0] ?? 0
    const isTrial = linkKind === 'trial' || headers.some((h) => norm(h) === 'claims')
    const links: Link[] = []
    for (const row of rows.slice(1)) {
      const name = row[nameIndex]?.trim()
      if (!name || /^total/i.test(name)) continue
      const link: Link = { name, kind: isTrial ? 'trial' : 'tracking' }
      for (const [index, field] of linkCols) {
        if (field === 'name') continue
        if (field === 'source') link.source = row[index]?.trim() || null
        else link[field] = parseNumber(row[index]) ?? null
      }
      links.push(link)
    }
    return {
      kind: 'links', days: [], links,
      mapped: Object.fromEntries([...linkCols].map(([i, k]) => [headers[i], k])),
      ignored: headers.filter((_, i) => !linkCols.has(i)),
    }
  }
  return { ...empty, ignored: headers }
}
