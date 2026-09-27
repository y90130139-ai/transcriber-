import type { Direction, TagKey } from '@/lib/performance/math'

const TREND = {
  up: { icon: '↑', label: 'Trending up' },
  down: { icon: '↓', label: 'Trending down' },
  flat: { icon: '→', label: 'Steady' },
} as const

/** Direction always carries an arrow and a word, never colour alone. */
export function TrendBadge({ trend, compactLabel = false }: { trend: Direction | null; compactLabel?: boolean }) {
  if (!trend) return <span className="dash-trend" data-trend="none">Not enough yet</span>
  const { icon, label } = TREND[trend]
  return (
    <span className="dash-trend" data-trend={trend} title={label}>
      <b aria-hidden>{icon}</b> {compactLabel ? label.replace('Trending ', '') : label}
    </span>
  )
}

export function TagChip({ tag, label, pinned }: { tag: TagKey | null; label: string | null; pinned?: boolean }) {
  if (!tag || !label) return null
  return (
    <span className="dash-tag" data-tag={tag} title={pinned ? 'Set by hand' : 'Automatic'}>
      {label}{pinned ? ' ·' : ''}
    </span>
  )
}
