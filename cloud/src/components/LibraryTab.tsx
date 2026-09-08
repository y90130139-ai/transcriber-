'use client'

import { useState } from 'react'
import BulkAssign from './roster/BulkAssign'
import FilterBar, { type Filters } from './FilterBar'
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
      <div className="searchline">
        <input
          className="searchline-input"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search what they said"
          aria-label="Search transcripts"
        />
        {query && (
          <button className="pill pill-clear" onClick={() => onQuery('')}>Clear</button>
        )}
      </div>

      <FilterBar filters={filters} creators={creators} onChange={onFilters} />

      <div className="section-head">
        <h2>{filters.hot ? 'Outperforming' : query ? 'Matches' : 'Library'}</h2>
        {/* "90 items" was true and read as complete. A truncated view now says
            so in the same breath as its own size. */}
        <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
          {loading
            ? 'Loading'
            : total > items.length
              ? `Showing ${items.length} of ${total}`
              : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {items.length > 0 ? (
        <>
          <LibraryGrid items={items} selected={selected} onOpen={onOpen} onToggle={toggle} />

          {/* The grid had no paging at all, so anything past the first page
              was unreachable no matter what was filtered on. */}
          {items.length < total && (
            <div className="loadmore">
              {atCap ? (
                <p className="hint">
                  Showing {items.length} of {total}. Narrow it with a filter or a
                  search to reach the rest.
                </p>
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
