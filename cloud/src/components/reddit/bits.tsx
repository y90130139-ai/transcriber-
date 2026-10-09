'use client'

import type { ReactNode } from 'react'
import type { TrendStatus } from '@/lib/reddit/types'
import type { RangeKey } from '@/lib/reddit/queries'
import { compact, signed } from '../dashboard/format'

/** Status words and their tone. Breakout is ember; everything else stays
 *  quiet ink so a table of forty rows does not shout. */
const STATUS_WORD: Record<TrendStatus, string> = {
  breakout: 'Breakout',
  rising: 'Rising',
  stable: 'Stable',
  cooling: 'Cooling',
  building: 'Building baseline',
}

export function StatusPill({ status }: { status: TrendStatus }) {
  return <i className="rt-status" data-tone={status}>{STATUS_WORD[status]}</i>
}

/** The brief's labelling rule, made visible: every figure says whether it
 *  was observed, calculated from observations, or estimated. */
export function Basis({ basis }: { basis: 'observed' | 'calculated' | 'estimate' }) {
  const word = basis === 'estimate' ? 'estimated' : basis
  return <i className="rt-basis" data-basis={basis} title={
    basis === 'observed' ? 'Read directly from Reddit responses'
      : basis === 'calculated' ? 'Computed by the trend engine from observed data'
      : 'An estimate over observed data — not an impression count'
  }>{word}</i>
}

export function GrowthText({ value }: { value: number | null }) {
  if (value === null) return <span className="rt-dim" title="No baseline yet">new</span>
  const pct = Math.round(value * 100)
  return (
    <span className="rt-growth" data-dir={pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat'}>
      {pct > 0 ? `+${pct}` : pct}%
    </span>
  )
}

export function Metric({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="rt-metric">
      <span className="rt-metric-label">{label}</span>
      <b className="rt-metric-value" data-tone={tone}>{value}</b>
      {note && <span className="rt-metric-note">{note}</span>}
    </div>
  )
}

export function Empty({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="rt-empty">
      <b>{title}</b>
      <p>{note}</p>
      {action}
    </div>
  )
}

export function Skeletons({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rt-skel" aria-hidden>
      {Array.from({ length: rows }, (_, index) => <i key={index} />)}
    </div>
  )
}

export const RANGE_LABEL: Record<RangeKey, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  custom: 'Custom',
}

export function RangeBar({
  value, options, onChange,
}: {
  value: RangeKey
  options: RangeKey[]
  onChange: (range: RangeKey) => void
}) {
  return (
    <div className="rt-range" role="group" aria-label="Date range">
      {options.map((range) => (
        <button key={range} type="button" className="rt-range-btn" data-on={range === value}
          onClick={() => onChange(range)}>
          {RANGE_LABEL[range]}
        </button>
      ))}
    </div>
  )
}

/** Export goes straight to the dataset route as a download — the CSV is
 *  built server-side from the same cached aggregates the page shows. */
export function ExportButton({ kind, label = 'Export CSV' }: { kind: 'topics' | 'subreddits'; label?: string }) {
  return (
    <a className="rt-btn rt-btn-quiet" href={`/api/reddit/dataset?export=${kind}`} download>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
      </svg>
      {label}
    </a>
  )
}

export function RefreshButton({ onClick, busy, label = 'Refresh' }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" className="rt-btn" onClick={onClick} disabled={busy}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" />
      </svg>
      {busy ? 'Collecting…' : label}
    </button>
  )
}

/** A future time, said in the reader's terms ("in 6m", "due now"). */
export function untilLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return 'due now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  return `in ${Math.round(minutes / 60)}h`
}

/** Relative time from an ISO stamp, in the reader's terms. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export function shortBucket(bucket: string, bucketSize: 'hour' | 'day'): string {
  if (bucketSize === 'day') {
    const [, month, day] = bucket.split('-').map(Number)
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${day} ${MONTHS[month - 1]}`
  }
  const [date, time] = bucket.split('T')
  const [, , day] = date.split('-').map(Number)
  return `${day} · ${time?.slice(0, 5) ?? ''}`
}

/** Numbers this feature says them: 4.4K, +2.4K, 82.3. */
export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (digits > 0) return value.toFixed(digits)
  return compact(value)
}

export { compact, signed }
