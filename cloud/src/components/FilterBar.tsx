'use client'

import { useState } from 'react'
import { AXES, taxonomy } from '@/lib/taxonomy'

export type Filters = {
  persona: string[]
  format: string[]
  hook: string[]
  topic: string[]
  creator: string
  window: '' | 'week' | '30' | '90'
  hot: boolean
  sort: 'recent' | 'hot' | 'likes' | 'added'
}

export const EMPTY_FILTERS: Filters = {
  persona: [], format: [], hook: [], topic: [], creator: '', window: '', hot: false, sort: 'recent',
}

export function toQuery(filters: Filters, query: string): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  for (const axis of AXES) if (filters[axis].length) params.set(axis, filters[axis].join(','))
  if (filters.creator) params.set('creator', filters.creator)
  if (filters.window) params.set('window', filters.window)
  if (filters.hot) params.set('hot', '1')
  if (filters.sort !== 'recent') params.set('sort', filters.sort)
  return params.toString()
}

const SORTS: { id: Filters['sort']; label: string }[] = [
  { id: 'recent', label: 'Newest post' },
  { id: 'hot', label: 'Outperformance' },
  { id: 'likes', label: 'Most liked' },
  { id: 'added', label: 'Just added' },
]

const WINDOWS: { id: Filters['window']; label: string }[] = [
  { id: '', label: 'All time' },
  { id: '90', label: 'Last 90 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'week', label: 'This week' },
]

export default function FilterBar({
  filters,
  creators,
  onChange,
}: {
  filters: Filters
  creators: { handle: string; posts: number }[]
  onChange: (next: Filters) => void
}) {
  const [openAxis, setOpenAxis] = useState<string | null>(null)
  const active =
    filters.persona.length + filters.format.length + filters.hook.length +
    (filters.creator ? 1 : 0) + (filters.window ? 1 : 0) + (filters.hot ? 1 : 0)

  const toggleTag = (axis: (typeof AXES)[number], id: string) => {
    const current = filters[axis]
    onChange({
      ...filters,
      [axis]: current.includes(id) ? current.filter((tag) => tag !== id) : [...current, id],
    })
  }

  return (
    <section className="filters" aria-label="Filters">
      <div className="filter-rail">
        <button
          className="pill"
          data-on={filters.hot}
          onClick={() => onChange({ ...filters, hot: !filters.hot })}
        >
          🔥 Hot
        </button>

        {AXES.map((axis) => (
          <button
            key={axis}
            className="pill"
            data-on={filters[axis].length > 0}
            onClick={() => setOpenAxis(openAxis === axis ? null : axis)}
          >
            {taxonomy[axis].label}
            {filters[axis].length > 0 && <b> {filters[axis].length}</b>}
          </button>
        ))}

        <select
          className="pill pill-select"
          value={filters.creator}
          onChange={(event) => onChange({ ...filters, creator: event.target.value })}
          aria-label="Creator"
        >
          <option value="">Every creator</option>
          {creators.map((creator) => (
            <option key={creator.handle} value={creator.handle}>
              {creator.handle} ({creator.posts})
            </option>
          ))}
        </select>

        <select
          className="pill pill-select"
          value={filters.window}
          onChange={(event) => onChange({ ...filters, window: event.target.value as Filters['window'] })}
          aria-label="Date range"
        >
          {WINDOWS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>

        <select
          className="pill pill-select"
          value={filters.sort}
          onChange={(event) => onChange({ ...filters, sort: event.target.value as Filters['sort'] })}
          aria-label="Sort"
        >
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>

        {active > 0 && (
          <button className="pill pill-clear" onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}>
            Clear {active}
          </button>
        )}
      </div>

      {openAxis && (
        <div className="filter-tags">
          {taxonomy[openAxis as (typeof AXES)[number]].tags.map((tag) => (
            <button
              key={tag.id}
              className="chip"
              data-on={filters[openAxis as (typeof AXES)[number]].includes(tag.id)}
              onClick={() => toggleTag(openAxis as (typeof AXES)[number], tag.id)}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
