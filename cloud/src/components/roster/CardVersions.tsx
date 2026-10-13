'use client'

/**
 * A format card's versions as fields (Geno, 2026-10-13): one row per version,
 * outfit and caption, editable in place. The whole list saves on blur through
 * the same items PATCH the rest of the card uses — empty rows are dropped
 * server-side, so a half-typed row never lands.
 */
import { useState } from 'react'
import { MAX_CARD_VERSIONS, type CardVersion } from '@/lib/styles'

export default function CardVersions({ versions, onSave }: {
  versions: CardVersion[]
  onSave: (next: CardVersion[]) => void | Promise<unknown>
}) {
  const [rows, setRows] = useState<CardVersion[]>(versions)

  function commit(next: CardVersion[]) {
    setRows(next)
    void onSave(next)
  }

  return (
    <div className="cardvers" role="group" aria-label="Versions — what changes each time">
      {rows.map((row, at) => (
        <div className="cardvers-row" key={at}>
          <span className="cardvers-no">V{at + 1}</span>
          <input
            className="field"
            value={row.outfit}
            placeholder="Outfit"
            aria-label={`Version ${at + 1} outfit`}
            onChange={(event) => setRows((list) => list.map((v, i) => (i === at ? { ...v, outfit: event.target.value } : v)))}
            onBlur={() => commit(rows)}
          />
          <input
            className="field"
            value={row.caption}
            placeholder="Caption"
            aria-label={`Version ${at + 1} caption`}
            onChange={(event) => setRows((list) => list.map((v, i) => (i === at ? { ...v, caption: event.target.value } : v)))}
            onBlur={() => commit(rows)}
          />
          <button
            type="button"
            className="cardtool"
            aria-label={`Remove version ${at + 1}`}
            onClick={() => commit(rows.filter((_, i) => i !== at))}
          >×</button>
        </div>
      ))}
      {rows.length < MAX_CARD_VERSIONS && (
        <button
          type="button"
          className="btn btn-small btn-quiet cardvers-add"
          onClick={() => commit([...rows, { outfit: '', caption: '' }])}
        >+ Add version</button>
      )}
    </div>
  )
}
