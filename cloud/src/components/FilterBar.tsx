import { AXES } from '@/lib/taxonomy'

export type Filters = {
  persona: string[]
  format: string[]
  hook: string[]
  topic: string[]
  creator: string
  window: '' | 'week' | '30' | '90'
  hot: boolean
  sort: 'recent' | 'hot' | 'likes' | 'added'
  /** The live library, what is about to leave it, or what already has. */
  shelf: '' | 'expiring' | 'archived'
}

export const EMPTY_FILTERS: Filters = {
  persona: [], format: [], hook: [], topic: [], creator: '', window: '', hot: false, sort: 'recent', shelf: '',
}

export function toQuery(filters: Filters, query: string): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  for (const axis of AXES) if (filters[axis].length) params.set(axis, filters[axis].join(','))
  if (filters.creator) params.set('creator', filters.creator)
  if (filters.window) params.set('window', filters.window)
  if (filters.hot) params.set('hot', '1')
  if (filters.sort !== 'recent') params.set('sort', filters.sort)
  if (filters.shelf) params.set('shelf', filters.shelf)
  return params.toString()
}

export const SORTS: { id: Filters['sort']; label: string }[] = [
  { id: 'recent', label: 'Newest post' },
  { id: 'hot', label: 'Outperformance' },
  { id: 'likes', label: 'Most liked' },
  { id: 'added', label: 'Just added' },
]

export const WINDOWS: { id: Filters['window']; label: string }[] = [
  { id: '', label: 'All time' },
  { id: '90', label: 'Last 90 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'week', label: 'This week' },
]
