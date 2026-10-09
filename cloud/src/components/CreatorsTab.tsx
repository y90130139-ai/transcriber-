'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import CreatorSheet from './CreatorSheet'
import PersonaBackfill, { BATCH } from './PersonaBackfill'
import DropMulti from './dashboard/DropMulti'
import DropSelect from './dashboard/DropSelect'
import { compact, thumbUrl } from '@/lib/format'
import { labelOf, taxonomy } from '@/lib/taxonomy'

export type Creator = {
  handle: string
  display_name: string | null
  persona: string[]
  posts: number
  recent_posts: number
  median_score: number | null
  last_upload: string | null
  cover_id: string | null
}

type Sort = 'posts' | 'active' | 'normal' | 'recent' | 'name'

const SORTS: { id: Sort; label: string }[] = [
  { id: 'posts', label: 'Most held' },
  { id: 'active', label: 'Most active (90d)' },
  { id: 'normal', label: 'Biggest normal' },
  { id: 'recent', label: 'Posted most recently' },
  { id: 'name', label: 'A–Z' },
]

/** Sorting a null to the bottom rather than to zero, whichever way we read it. */
const desc = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1)

export default function CreatorsTab({ onFilterTo }: { onFilterTo: (handle: string) => void }) {
  const [creators, setCreators] = useState<Creator[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const [persona, setPersona] = useState<string[]>([])
  // Persona carries to every future post a creator makes, so the ones missing
  // it are the highest-value thing on this screen to go and fix.
  const [needsPersona, setNeedsPersona] = useState(false)
  // The backfill trigger sits beside the filter it belongs to; the panel it
  // opens renders under the search line, where the work happens.
  const [backfill, setBackfill] = useState(false)
  const [sort, setSort] = useState<Sort>('posts')

  const load = useCallback(async () => {
    const response = await fetch('/api/creators')
    if (response.ok) setCreators((await response.json()).creators ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = creators.filter((creator) => {
      if (needsPersona && creator.persona.length > 0) return false
      if (persona.length > 0 && !persona.some((tag) => creator.persona.includes(tag))) return false
      if (!needle) return true
      return (
        creator.handle.toLowerCase().includes(needle) ||
        (creator.display_name ?? '').toLowerCase().includes(needle)
      )
    })
    // Sorted on a copy — the fetched list stays as the server ordered it.
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.handle.localeCompare(b.handle)
      if (sort === 'active') return desc(a.recent_posts, b.recent_posts) || desc(a.posts, b.posts)
      if (sort === 'normal') return desc(a.median_score, b.median_score)
      if (sort === 'recent') return (b.last_upload ?? '').localeCompare(a.last_upload ?? '')
      return desc(a.posts, b.posts)
    })
  }, [creators, needsPersona, persona, query, sort])

  const active = persona.length + (query.trim() ? 1 : 0) + (needsPersona ? 1 : 0)

  const tally = loading
    ? 'Loading'
    : active > 0
      ? `${shown.length} of ${creators.length}`
      : `${creators.length} creator${creators.length === 1 ? '' : 's'}`

  return (
    <>
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Creators</h2>
          <p className="dash-sub">{tally}</p>
        </div>
        <div className="dash-head-tools">
          <div className="dash-head-controls">
            <button className="pill" data-on={needsPersona} onClick={() => setNeedsPersona(!needsPersona)}>
              Needs persona
            </button>
            <button className="pill" data-on={backfill} onClick={() => setBackfill(!backfill)}>
              Persona backfill — propose for the top {BATCH}
            </button>
            <DropMulti
              values={persona}
              onChange={setPersona}
              label={taxonomy.persona.label}
              summary={taxonomy.persona.label}
              options={taxonomy.persona.tags.map((tag) => ({ value: tag.id, label: tag.label }))}
            />
            <DropSelect
              value={sort}
              onChange={(next) => setSort(next as Sort)}
              label="Sort creators"
              options={SORTS.map((option) => ({ value: option.id, label: option.label }))}
            />
            {active > 0 && (
              <button
                className="pill pill-clear"
                onClick={() => { setQuery(''); setPersona([]); setNeedsPersona(false) }}
              >
                Clear {active}
              </button>
            )}
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a creator"
          aria-label="Find a creator"
        />
        {query && (
          <button type="button" className="minput-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
        )}
      </div>

      {/* Only 44 of 166 items carry a persona. Fixing that per item is 166
          decisions; per creator it is about ten. */}
      <PersonaBackfill open={backfill} onOpenChange={setBackfill} onApplied={() => void load()} />

      {creators.length === 0 && !loading ? (
        <div className="empty"><p>No creators yet. Add a few reels first.</p></div>
      ) : shown.length === 0 ? (
        <div className="empty"><p>No creator matches that.</p></div>
      ) : (
        <div className="creators">
          {shown.map((creator) => {
            const tags = creator.persona.slice(0, 2)
            const extra = creator.persona.length - tags.length
            return (
              <button key={creator.handle} className="creator-card" onClick={() => setOpen(creator.handle)}>
                <span className="creator-card-frame">
                  {creator.cover_id ? (
                    <img src={thumbUrl(creator.cover_id)} alt="" width={420} height={525} loading="lazy" />
                  ) : (
                    <span className="card-frame-empty">{creator.handle.slice(0, 1)}</span>
                  )}
                </span>
                <span className="creator-card-body">
                  <span className="creator-card-handle">@{creator.handle}</span>
                  <span className="creator-card-meta">
                    <b>{creator.posts}</b> held
                    <span aria-hidden="true">·</span>
                    <b>{creator.recent_posts}</b> in 90d
                    {creator.median_score !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <b>{compact(creator.median_score)}</b> normal
                      </>
                    )}
                  </span>
                  <span className="creator-card-tags">
                    {tags.length > 0
                      ? tags.map((tag) => <span key={tag}>{labelOf('persona', tag)}</span>)
                      : <span data-empty="true">No persona</span>}
                    {extra > 0 && <span className="creator-card-more">+{extra}</span>}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {open && (
        <CreatorSheet
          handle={open}
          onClose={() => setOpen(null)}
          onSaved={() => void load()}
          onFilterTo={(handle) => { setOpen(null); onFilterTo(handle) }}
        />
      )}
    </>
  )
}
