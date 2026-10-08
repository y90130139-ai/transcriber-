'use client'

import { useState } from 'react'
import BulkAssign from './roster/BulkAssign'
import DropMulti from './dashboard/DropMulti'
import DropSelect from './dashboard/DropSelect'
import { SORTS, WINDOWS, type Filters } from './FilterBar'
import { AXES, taxonomy } from '@/lib/taxonomy'
import LibraryGrid from './LibraryGrid'
import type { LibraryItem } from '@/lib/format'

export default function LibraryTab({
  items,
  creators,
  filters,
  query,
  loading,
  total,
  atCap,
  onMore,
  onFilters,
  onQuery,
  onOpen,
}: {
  items: LibraryItem[]
  creators: { handle: string; posts: number }[]
  filters: Filters
  query: string
  loading: boolean
  /** How many this filter holds, not how many came back. The difference
   *  between the two is the whole point of the count below. */
  total: number
  /** The grid has asked for as much as one request will return. */
  atCap: boolean
  onMore: () => void
  onFilters: (next: Filters) => void
  onQuery: (next: string) => void
  onOpen: (item: LibraryItem) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const narrowed =
    filters.persona.length + filters.format.length + filters.hook.length > 0 ||
    Boolean(filters.creator) || Boolean(filters.window) || filters.hot

  const title = filters.hot ? 'Outperforming' : query ? 'Matches' : 'Library'
  // "90 items" was true and read as complete. A truncated view now says so
  // in the same breath as its own size.
  const tally = loading
    ? 'Loading'
    : total > items.length
      ? `Showing ${items.length} of ${total}`
      : `${items.length} item${items.length === 1 ? '' : 's'}`

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function downloadSelected() {
    setBusy(true)
    setNote(null)
    const response = await fetch('/api/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setNote(body.error ?? 'Could not build that download.')
    } else {
      // One zip off the Mac, rather than twenty downloads the browser blocks.
      window.location.href = body.url
      setSelected(new Set())
    }
    setBusy(false)
  }

  return (
    <>
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">{title}</h2>
          <p className="dash-sub">{tally}</p>
        </div>
        <div className="dash-head-tools">
          <div className="dash-head-controls">
            <button
              className="pill"
              data-on={filters.hot}
              onClick={() => onFilters({ ...filters, hot: !filters.hot })}
            >
              🔥 Hot
            </button>
            <DropSelect
              value={filters.sort}
              onChange={(next) => onFilters({ ...filters, sort: next as Filters['sort'] })}
              label="Sort"
              options={SORTS.map((option) => ({ value: option.id, label: option.label }))}
            />
            <DropSelect
              value={filters.shelf}
              onChange={(next) => onFilters({ ...filters, shelf: next as Filters['shelf'] })}
              label="Shelf"
              options={[
                { value: '', label: 'All reels' },
                { value: 'expiring', label: 'Expiring' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            {AXES.map((axis) => (
              <DropMulti
                key={axis}
                values={filters[axis]}
                onChange={(next) => onFilters({ ...filters, [axis]: next })}
                label={taxonomy[axis].label}
                summary={taxonomy[axis].label}
                options={taxonomy[axis].tags.map((tag) => ({ value: tag.id, label: tag.label }))}
              />
            ))}
            <DropSelect
              value={filters.creator}
              onChange={(next) => onFilters({ ...filters, creator: next })}
              label="Creator"
              options={[{ value: '', label: 'Every creator' },
                ...creators.map((creator) => ({ value: creator.handle, label: `${creator.handle} (${creator.posts})` }))]}
            />
            <DropSelect
              value={filters.window}
              onChange={(next) => onFilters({ ...filters, window: next as Filters['window'] })}
              label="Date range"
              options={WINDOWS.map((option) => ({ value: option.id, label: option.label }))}
            />
          </div>
        </div>
      </header>

      <div className="searchline">
        <svg className="searchline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          className="searchline-input"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search what they said"
          aria-label="Search transcripts"
        />
        {query && (
          <button type="button" className="minput-clear" onClick={() => onQuery('')} aria-label="Clear search">×</button>
        )}
      </div>

      {items.length > 0 ? (
        <>
          <LibraryGrid items={items} selected={selected} onOpen={onOpen} onToggle={toggle} />

          {/* The grid had no paging at all, so anything past the first page
              was unreachable no matter what was filtered on. */}
          {items.length < total && (
            <div className="loadmore">
              {atCap ? (
                <p className="hint">Showing {items.length} of {total}.</p>
              ) : (
                <button className="btn btn-quiet" onClick={onMore}>
                  Load more — {total - items.length} left
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="empty">
          <p>
            {query || narrowed
              ? 'Nothing here matches that.'
              : 'Nothing yet. Paste a pile of links in the Queue.'}
          </p>
        </div>
      )}

      {selected.size > 0 && (
        <div className="selectbar" role="region" aria-label="Selection">
          <span className="tally"><b>{selected.size}</b> selected</span>
          <button className="btn" onClick={downloadSelected} disabled={busy}>
            {busy ? 'Zipping' : 'Download videos'}
          </button>
          {/* The single-item assign in the item view already works and is
              untouched. This is only the bulk path, which was six
              open-assign-close cycles for a shortlist of six. */}
          <BulkAssign jobIds={[...selected]} onAdded={() => setSelected(new Set())} />
          <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>Clear</button>
          {note && <span className="hint" data-tone="bad">{note}</span>}
        </div>
      )}
    </>
  )
}
