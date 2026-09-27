/** Numbers the way the dashboard says them: 4.4M, +2.4K, −25%. */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}K`
  return `${sign}${Math.round(abs)}`
}

const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''))

/** An axis label precise enough to tell its neighbours apart: 4.4M four times
 *  over says nothing, 4,410K / 4,420K does. */
export function tickLabel(value: number, step: number): string {
  if (step >= 100_000 || value < 10_000) return compact(value)
  if (step >= 1_000) return `${Math.round(value / 1_000).toLocaleString('en-US')}K`
  return Math.round(value).toLocaleString('en-US')
}

export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  return n > 0 ? `+${compact(n)}` : compact(n)
}

export function percent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const value = Math.round(n * 1000) / 10
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`
}

/** `26 Sep` from YYYY-MM-DD, no timezone involved. */
export function shortDay(day: string): string {
  const [, month, date] = day.split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${date} ${MONTHS[month - 1]}`
}

/** "today", "3 days ago", "5 weeks ago". */
export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return `${Math.floor(days / 7)} weeks ago`
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
