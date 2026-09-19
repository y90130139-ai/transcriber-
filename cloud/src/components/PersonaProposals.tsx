'use client'

import { useCallback, useEffect, useState } from 'react'
import taxonomy from '@/lib/taxonomy.json'

/**
 * Personas the profiler proposes, waiting on a human.
 *
 * 178 of 196 watched creators had no persona, and persona decides which model
 * is shown whose work — so it cannot be guessed silently, and it cannot be
 * read by hand either. The profiler looks at her best frames, captions and
 * bio and offers up to three tags with its reason. Here they are taken,
 * edited by tapping the chips, or rejected.
 */
type Proposal = {
  handle: string
  tags: string[]
  why: string | null
  poster: string | null
  followers: number | string | null
  reels: number
  bio: string | null
}

const PERSONA = (taxonomy as { persona: { tags: { id: string; label: string }[] } }).persona.tags
const labelFor = (id: string) => PERSONA.find((tag) => tag.id === id)?.label ?? id

export default function PersonaProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [edits, setEdits] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch('/api/creators/profile')
    if (!response.ok) return
    const body = await response.json()
    setProposals(body.proposals ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  const findMore = useCallback(async () => {
    setBusy(true)
    setNote('Looking at the next few…')
    const response = await fetch('/api/creators/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = response.ok ? await response.json() : null
    setNote(body ? `Profiled ${body.profiled}.` : 'That did not run.')
    setBusy(false)
    await load()
  }, [load])

  const settle = useCallback(async (handle: string, tags: string[] | null) => {
    setBusy(true)
    await fetch('/api/creators/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, tags }),
    })
    setBusy(false)
    setProposals((current) => current.filter((one) => one.handle !== handle))
  }, [])

  const toggle = (handle: string, tag: string, current: string[]) => {
    const next = current.includes(tag) ? current.filter((one) => one !== tag) : [...current, tag]
    setEdits((all) => ({ ...all, [handle]: next }))
  }

  return (
    <section className="proposals">
      <button className="watchlist-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Who these creators are</span>
        <span className="watchlist-counts">
          {proposals.length > 0 ? `${proposals.length} waiting on you` : 'nothing waiting'}
        </span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="proposals-body">
          <p className="watchlist-note">
            Read from her best frames, captions and bio. Tap a chip to change it, then take it —
            the persona carries to everything she posts.
          </p>
          <div className="watchlist-actions">
            <button className="pill" disabled={busy} onClick={() => void findMore()}>
              Profile the next three
            </button>
            {note && <span className="watchlist-said">{note}</span>}
          </div>

          <ul className="proposals-list">
            {proposals.map((one) => {
              const chosen = edits[one.handle] ?? one.tags
              return (
                <li key={one.handle}>
                  {one.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={one.poster} alt="" width={64} height={80} />
                  )}
                  <div className="proposals-who">
                    <a href={`https://instagram.com/${one.handle}`} target="_blank" rel="noreferrer">
                      @{one.handle}
                    </a>
                    <span>{Number(one.followers ?? 0).toLocaleString()} followers · {one.reels} reels seen</span>
                    {one.why && <em>{one.why}</em>}
                  </div>
                  <div className="proposals-tags">
                    {PERSONA.map((tag) => (
                      <button
                        key={tag.id}
                        className="chip"
                        data-on={chosen.includes(tag.id) || undefined}
                        onClick={() => toggle(one.handle, tag.id, chosen)}
                      >
                        {labelFor(tag.id)}
                      </button>
                    ))}
                  </div>
                  <div className="proposals-actions">
                    <button className="pill" disabled={busy || chosen.length === 0}
                            onClick={() => void settle(one.handle, chosen)}>
                      Take {chosen.length > 0 && `(${chosen.length})`}
                    </button>
                    <button className="pill" disabled={busy} onClick={() => void settle(one.handle, null)}>
                      None of these
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
