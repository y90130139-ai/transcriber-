'use client'

import { useState } from 'react'
import FilterBar, { type Filters } from './FilterBar'
import LibraryGrid from './LibraryGrid'
import type { LibraryItem } from '@/lib/format'

export default function LibraryTab({
  items,
  creators,
  filters,
  query,
  loading,
  onFilters,
  onQuery,
  onOpen,
}: {
  items: LibraryItem[]
  creators: { handle: string; posts: number }[]
  filters: Filters
  query: string
  loading: boolean
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
        <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
          {loading ? 'Loading' : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {items.length > 0 ? (
        <LibraryGrid items={items} selected={selected} onOpen={onOpen} onToggle={toggle} />
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
          <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>Clear</button>
          {note && <span className="hint" data-tone="bad">{note}</span>}
        </div>
      )}
    </>
  )
}
