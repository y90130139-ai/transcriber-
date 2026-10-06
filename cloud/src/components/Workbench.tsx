'use client'

import { useCallback, useEffect, useState } from 'react'
import ItemView from './ItemView'
import CreatorsTab from './CreatorsTab'
import DigestTab from './DigestTab'
import LibraryTab from './LibraryTab'
import QueueTab from './QueueTab'
import RosterTab from './roster/RosterTab'
import SweepTab from './roster/SweepTab'
import TrendsTab from './TrendsTab'
import { EMPTY_FILTERS, toQuery, type Filters } from './FilterBar'
import type { LibraryItem } from '@/lib/format'
import DashboardHome from './dashboard/DashboardHome'

type Counts = { queued: number; running: number; done: number; failed: number; waiting?: number }
type Worker = { online: boolean; secondsAgo: number | null; video: boolean }
// `creators` is the Instagram accounts we research — the word the database and
// /api/creators already use. `models` is our own people, who are a different
// entity in a different table and get their own tab.
type Tab = 'dashboard' | 'queue' | 'library' | 'creators' | 'models' | 'today' | 'week' | 'trends'

// Poll hard while the Mac is chewing on something, gently when it is idle.
const POLL_BUSY_MS = 2500
const POLL_IDLE_MS = 15_000
const SEARCH_DEBOUNCE_MS = 220

/** One page of the library. Must match `PAGE_SIZE` in /api/library — the
 *  response carries the server's own value, and a mismatch would only ever
 *  make the increment wrong, never the data. */
const PAGE = 90

/** The span the grid will ask for in a single request, mirroring the route's
 *  `MAX_LIMIT`. The grid re-requests everything it has open on every poll —
 *  that is what stops a fifteen-second refresh truncating a view somebody
 *  deliberately expanded — so the span has to be bounded somewhere. */
const MAX_SPAN = PAGE * 20

const TABS: { id: Tab; label: string }[] = [
  // First and where the console opens (Geno, 2026-09-27): where every model
  // stands before anything else. The queue moved to the far end.
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'library', label: 'Library' },
  { id: 'creators', label: 'Creators' },
  { id: 'models', label: 'Models' },
  // Appended rather than slotted in front, so four tabs of muscle memory keep
  // pointing at what they always did.
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  // Discovery (Geno, 2026-10-06): Google's search trends beside the
  // library's own breakouts and sounds, with the Trends AI box on top.
  { id: 'trends', label: 'Trends' },
  { id: 'queue', label: 'Queue' },
]

export default function Workbench() {
  const [tab, setTab] = useState<Tab>('dashboard')
  // Set from the sweep, which hands the roster a model to open rather than
  // making Geno find her again in a grid.
  const [openModel, setOpenModel] = useState<string | null>(null)
  /** A model the dashboard asked for: her profile, on Analytics. */
  const [openProfile, setOpenProfile] = useState<string | null>(null)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [pending, setPending] = useState<LibraryItem[]>([])
  const [counts, setCounts] = useState<Counts>({ queued: 0, running: 0, done: 0, failed: 0 })
  const [worker, setWorker] = useState<Worker>({ online: false, secondsAgo: null, video: false })
  const [creators, setCreators] = useState<{ handle: string; posts: number }[]>([])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<LibraryItem | null>(null)
  // How many the current filter actually holds, and how many of them the grid
  // is asking for. Before this the grid took the first 90 and said "90 items",
  // which is indistinguishable from a complete answer.
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
  // database. `span` is in here too: growing it is what "Load more" does, and
  // it goes through the same single fetch path as everything else.
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
  // to a creator while six pages deep and staying six pages deep would ask for
  // 540 of her 60 items and read as if the filter had failed.
  const applyFilters = (next: Filters) => { setSpan(PAGE); setFilters(next) }
  const applyQuery = (next: string) => { setSpan(PAGE); setQuery(next) }

  return (
    /* Phase 6. Every console rule that differs from the maison default hangs
       off this one class — the radius above all — so it can never reach her
       plan page, which scopes its own on `.plan`. */
    <div className="console">
      <header className="masthead">
        <h1 className="wordmark">Library<span className="dot">.</span></h1>

        <nav className="tabs" aria-label="Sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              className="tab"
              data-on={tab === entry.id}
              aria-current={tab === entry.id ? 'page' : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.id === 'queue' && counts.queued + counts.running > 0 && (
                <b> {counts.queued + counts.running}</b>
              )}
            </button>
          ))}
        </nav>

        <div className="masthead-meta">
          <span className="tally">
            <b>{counts.done}</b> held
            {(counts.waiting ?? 0) > 0 && <> · <b>{counts.waiting}</b> waiting</>}
            {counts.failed - (counts.waiting ?? 0) > 0 && <> · <b>{counts.failed - (counts.waiting ?? 0)}</b> need you</>}
          </span>
          <span className="status" data-online={worker.online}>
            <span className="beacon" aria-hidden />
            {worker.online ? (worker.video ? 'Mac live' : 'Mac listening') : 'Mac asleep'}
          </span>
        </div>
      </header>

      <main className="page">
        {tab === 'dashboard' && (
          <DashboardHome onOpenModel={(id) => { setOpenProfile(id); setTab('models') }} />
        )}

        {tab === 'queue' && (
          <QueueTab
            pending={pending}
            workerOnline={worker.online}
            onChanged={reload}
            onOpen={setOpen}
          />
        )}

        {tab === 'library' && (
          <LibraryTab
            items={items}
            creators={creators}
            filters={filters}
            query={query}
            loading={loading}
            total={total}
            atCap={span >= MAX_SPAN}
            onMore={() => setSpan((current) => Math.min(current + PAGE, MAX_SPAN))}
            onFilters={applyFilters}
            onQuery={applyQuery}
            onOpen={setOpen}
          />
        )}

        {tab === 'creators' && (
          <CreatorsTab
            onFilterTo={(handle) => {
              applyFilters({ ...EMPTY_FILTERS, creator: handle })
              setQuery('')
              setTab('library')
            }}
          />
        )}

        {tab === 'models' && (
          <RosterTab
            openPlanFor={openModel}
            openProfileFor={openProfile}
            onOpened={() => { setOpenModel(null); setOpenProfile(null) }}
          />
        )}

        {tab === 'week' && (
          <DigestTab
            onFilterTo={(handle) => {
              applyFilters({ ...EMPTY_FILTERS, creator: handle })
              setQuery('')
              setTab('library')
            }}
          />
        )}

        {tab === 'today' && (
          <SweepTab
            onOpenModel={(id) => { setOpenModel(id); setTab('models') }}
          />
        )}

        {tab === 'trends' && <TrendsTab />}
      </main>

      {open && <ItemView item={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  )
}
