'use client'

import { useEffect, useRef } from 'react'
import type { ModelPerf } from '@/lib/performance/load'
import Avatar from './Avatar'
import { ago } from './format'

/**
 * Who needs attention, and why — opened from the count on the Models card.
 * The reasons are the same rules that set the tag (lib/performance/math.ts),
 * said in plain words; tapping a model opens her Analytics tab.
 */
export default function AttentionPanel({ models, onOpen, onClose }: {
  models: ModelPerf[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [])
  const needing = models
    .filter((m) => m.tag === 'attention')
    .sort((a, b) => b.attention_reasons.length - a.attention_reasons.length || a.name.localeCompare(b.name))

  return (
    <section ref={panel} className="dash-panel dash-attention" aria-labelledby="dash-att-h">
      <header className="dash-panel-head dash-attention-head">
        <div>
          <h2 id="dash-att-h">Needs attention <span>{needing.length}</span></h2>
          <p>Why each one is flagged. Tap a name to open their numbers.</p>
        </div>
        <button className="chip" onClick={onClose} aria-label="Close">Close</button>
      </header>
      {needing.length === 0 ? <p className="dash-empty">Nobody right now.</p> : (
        <ul className="dash-att-list">
          {needing.map((m) => (
            <li key={m.id}>
              <button className="dash-att-row" onClick={() => onOpen(m.id)}>
                <Avatar name={m.name} src={m.photo_url} size={40} />
                <span className="dash-att-who">
                  <b>{m.name}</b>
                  <small>{m.handles[0] ? `@${m.handles[0]}` : 'No Instagram on file'} · last post {ago(m.last_posted_at)}</small>
                </span>
                <ul className="dash-att-why">
                  {m.attention_reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                <span className="dash-att-go" aria-hidden>→</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
