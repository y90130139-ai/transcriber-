'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import PersonaProposals from './PersonaProposals'
import WatchlistPanel from './WatchlistPanel'
import CreatorSheet from './CreatorSheet'
import PersonaBackfill from './PersonaBackfill'
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
  const [showPersona, setShowPersona] = useState(false)
  // Persona carries to every future post a creator makes, so the ones missing
  // it are the highest-value thing on this screen to go and fix.
  const [needsPersona, setNeedsPersona] = useState(false)
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

  return (
    <>
      <WatchlistPanel />
      <PersonaProposals />
      <section className="filters" aria-label="Creator filters">
        <div className="filter-rail">
          <input
            className="pill pill-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a creator"
            aria-label="Find a creator"
          />

          <button
            className="pill"
            data-on={persona.length > 0}
            onClick={() => setShowPersona(!showPersona)}
          >
            {taxonomy.persona.label}
            {persona.length > 0 && <b> {persona.length}</b>}
          </button>

          <button className="pill" data-on={needsPersona} onClick={() => setNeedsPersona(!needsPersona)}>
            Needs persona
          </button>

          <select
            className="pill pill-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label="Sort creators"
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>

          {active > 0 && (
            <button
              className="pill pill-clear"
              onClick={() => { setQuery(''); setPersona([]); setNeedsPersona(false) }}
            >
              Clear {active}
            </button>
          )}
        </div>

        {showPersona && (
          <div className="filter-tags">
            {taxonomy.persona.tags.map((tag) => (
              <button
                key={tag.id}
                className="chip"
                data-on={persona.includes(tag.id)}
                onClick={() =>
                  setPersona((current) =>
                    current.includes(tag.id)
                      ? current.filter((id) => id !== tag.id)
                      : [...current, tag.id],
                  )
                }
              >
                {tag.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Only 44 of 166 items carry a persona. Fixing that per item is 166
          decisions; per creator it is about ten. */}
      <PersonaBackfill onApplied={() => void load()} />

      <div className="section-head">
        <h2>Creators</h2>
        <span className="tally" style={{ color: 'var(--sc-ink-300)' }}>
          {loading
            ? 'Loading'
            : active > 0
              ? `${shown.length} of ${creators.length}`
              : `${creators.length} creator${creators.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {creators.length === 0 && !loading ? (
        <div className="empty"><p>No creators yet. Add a few reels first.</p></div>
      ) : shown.length === 0 ? (
        <div className="empty"><p>No creator matches that.</p></div>
      ) : (
        <div className="models">
          {shown.map((creator) => (
            <button key={creator.handle} className="model" onClick={() => setOpen(creator.handle)}>
              <span className="model-frame">
                {creator.cover_id ? (
                  <img src={thumbUrl(creator.cover_id)} alt="" width={420} height={525} loading="lazy" />
                ) : (
                  <span className="card-frame-empty">{creator.handle}</span>
                )}
              </span>
              <span className="model-handle">{creator.handle}</span>
              {creator.display_name && <span className="model-name">{creator.display_name}</span>}
              <span className="model-persona">
                {creator.persona.length > 0
                  ? creator.persona.map((tag) => (
                      <span key={tag}>{labelOf('persona', tag)}</span>
                    ))
                  : <span data-empty="true">No persona set</span>}
              </span>
              <span className="model-figures">
                <b>{creator.posts}</b> held · <b>{creator.recent_posts}</b> in 90d ·
                normal <b>{compact(creator.median_score)}</b>
              </span>
            </button>
          ))}
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
