'use client'

import { useState } from 'react'
import type { LibraryItem } from '@/lib/format'
import { stuckReason, waitingLine } from '@/lib/queue-state'

/**
 * The two kinds of "failed" (lib/queue-state.ts), kept apart from live work.
 * Waiting reels are the viewer's job and fold away; stuck ones need a person
 * and stay open, each with a reason in words and a Retry.
 */

export function WaitingList({ items, onOpen }: { items: LibraryItem[]; onOpen: (item: LibraryItem) => void }) {
  if (items.length === 0) return null
  return (
    <details className="queue-fold">
      <summary>
        <span className="queue-fold-title">Waiting for a signed-in look</span>
        <span className="queue-fold-count">{items.length}</span>
        <span className="queue-fold-note">
          Instagram hides these from logged-out downloads. The viewer opens each one signed in,
          a few an hour, and it drops back into the queue by itself.
        </span>
      </summary>
      <section className="queue" aria-label="Waiting for the viewer">
        {items.map((item) => (
          <div className="queue-row queue-row-held" key={item.id} data-state="viewer">
            <span className="queue-mark" aria-hidden>◌</span>
            <button className="queue-label" onClick={() => onOpen(item)}>{item.label}</button>
            <span className="queue-stage">{waitingLine(item)}</span>
          </div>
        ))}
      </section>
    </details>
  )
}

export function StuckList({
  items,
  onOpen,
  onChanged,
}: {
  items: LibraryItem[]
  onOpen: (item: LibraryItem) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (items.length === 0) return null

  async function retry(item: LibraryItem) {
    setBusy(item.id)
    setError(null)
    try {
      const response = await fetch(`/api/items/${item.id}`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      onChanged()
    } catch {
      setError('Could not put that one back in the queue. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="dash-panel" aria-label="Needs you">
      <header className="dash-panel-head">
        <h2>Needs you</h2>
        <p>{items.length} item{items.length === 1 ? '' : 's'} · a person has to clear these</p>
      </header>
      {error && <p className="hint" data-tone="bad">{error}</p>}
      <section className="queue" aria-label="Needs you">
        {items.map((item) => (
          <div className="queue-row queue-row-held" key={item.id} data-state="stuck">
            <span className="queue-mark" aria-hidden>×</span>
            <button className="queue-label" onClick={() => onOpen(item)}>{item.label}</button>
            <span className="queue-stage">{stuckReason(item)}</span>
            <button className="pill queue-retry" disabled={busy === item.id} onClick={() => void retry(item)}>
              {busy === item.id ? 'Queuing…' : 'Retry'}
            </button>
          </div>
        ))}
      </section>
    </section>
  )
}
