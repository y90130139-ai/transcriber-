'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { EMPTY_FILTERS, toQuery, type Filters } from '../FilterBar'
import type { LibraryItem } from '@/lib/format'

/** One page of the library. Must match `PAGE_SIZE` in /api/library. */
export const PAGE = 90
const MAX_SPAN = PAGE * 20

// Poll hard while the Mac is chewing on something, gently when it is idle.
const POLL_BUSY_MS = 2500
const POLL_IDLE_MS = 15_000
const SEARCH_DEBOUNCE_MS = 220

type Counts = { queued: number; running: number; done: number; failed: number; waiting?: number }
type Worker = { online: boolean; secondsAgo: number | null; video: boolean }

type ConsoleState = {
  items: LibraryItem[]
  pending: LibraryItem[]
  counts: Counts
  worker: Worker
  creators: { handle: string; posts: number }[]
  filters: Filters
  query: string
  loading: boolean
  total: number
  span: number
  atCap: boolean
  openItem: LibraryItem | null
  applyFilters: (next: Filters) => void
  applyQuery: (next: string) => void
  onMore: () => void
  reload: () => void
  setOpenItem: (item: LibraryItem | null) => void
}

const ConsoleContext = createContext<ConsoleState | null>(null)

export function useConsole(): ConsoleState {
  const state = useContext(ConsoleContext)
  if (!state) throw new Error('useConsole must be used inside ConsoleProvider')
  return state
}

/** Everything the console's pages share: the library list and its polling,
 *  the counts the masthead wears, and the open reader. The layout holds this,
 *  so switching pages never loses a search or restarts a poll. */
export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [pending, setPending] = useState<LibraryItem[]>([])
  const [counts, setCounts] = useState<Counts>({ queued: 0, running: 0, done: 0, failed: 0 })
  const [worker, setWorker] = useState<Worker>({ online: false, secondsAgo: null, video: false })
  const [creators, setCreators] = useState<{ handle: string; posts: number }[]>([])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState<LibraryItem | null>(null)
  const [total, setTotal] = useState(0)
  const [span, setSpan] = useState(PAGE)

  const refresh = useCallback(async (current: Filters, search: string, want: number) => {
    const response = await fetch(`/api/library?${toQuery(current, search)}&limit=${want}`)
    if (!response.ok) return
    const body = await response.json()
    setItems(body.items ?? [])
    setTotal(Number(body.total ?? 0))
    setPending(body.pending ?? [])
    setCounts(body.counts ?? { queued: 0, running: 0, done: 0, failed: 0 })
    setWorker(body.worker ?? { online: false, secondsAgo: null, video: false })
    setLoading(false)
  }, [])

  // Search and filter changes are debounced so typing does not hammer the
  // database. `span` is in here too: growing it is what "Load more" does.
  useEffect(() => {
    const timer = setTimeout(() => { void refresh(filters, query, span) }, query ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [filters, query, span, refresh])

  useEffect(() => {
    const active = counts.queued + counts.running > 0
    const timer = setInterval(
      () => { void refresh(filters, query, span) },
      active ? POLL_BUSY_MS : POLL_IDLE_MS,
    )
    return () => clearInterval(timer)
  }, [counts.queued, counts.running, filters, query, span, refresh])

  useEffect(() => {
    fetch('/api/creators')
      .then((response) => (response.ok ? response.json() : { creators: [] }))
      .then((body) => setCreators(body.creators ?? []))
      .catch(() => setCreators([]))
  }, [counts.done])

  const reload = () => { void refresh(filters, query, span) }

  // Any change to what is being asked for starts again at page one. Narrowing
  // while pages deep and staying deep would ask for 540 of 60 items and read
  // as if the filter had failed.
  const applyFilters = (next: Filters) => { setSpan(PAGE); setFilters(next) }
  const applyQuery = (next: string) => { setSpan(PAGE); setQuery(next) }
  const onMore = () => setSpan((current) => Math.min(current + PAGE, MAX_SPAN))

  return (
    <ConsoleContext.Provider value={{
      items, pending, counts, worker, creators, filters, query, loading, total,
      span, atCap: span >= MAX_SPAN, openItem,
      applyFilters, applyQuery, onMore, reload, setOpenItem: setOpenItem,
    }}>
      {children}
    </ConsoleContext.Provider>
  )
}
