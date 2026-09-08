'use client'

import { useMemo, useState } from 'react'
import { taxonomy, type Axis } from '@/lib/taxonomy'
import type { TagRow } from '@/lib/format'

/** One axis of tags on one item.
 *
 * A guess and a decision look different on purpose: suggested tags are outlined
 * and carry a dot, confirmed ones are filled. Confirming is one tap, which is
 * the only reason tagging a few hundred videos is survivable.
 */
export default function TagPicker({
  axis,
  tags,
  onSave,
}: {
  axis: Axis
  tags: TagRow[]
  onSave: (tags: string[]) => Promise<void> | void
}) {
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const spec = taxonomy[axis]

  const chosen = useMemo(() => tags.filter((tag) => tag.axis === axis), [tags, axis])
  const ids = chosen.map((tag) => tag.tag)
  const unconfirmed = chosen.some((tag) => tag.origin === 'auto')

  const matches = spec.tags.filter((tag) =>
    query ? `${tag.label} ${tag.desc}`.toLowerCase().includes(query.toLowerCase()) : true,
  )

  const toggle = (id: string) =>
    onSave(ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id])

  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-name">{spec.label}</span>
        {unconfirmed && (
          <button className="axis-confirm" onClick={() => onSave(ids)}>
            Confirm
          </button>
        )}
      </div>

      <div className="chips">
        {chosen.map((tag) => (
          <button
            key={tag.tag}
            className="chip"
            data-origin={tag.origin}
            onClick={() => toggle(tag.tag)}
            title={tag.origin === 'auto' ? 'Suggested — tap to remove' : 'Tap to remove'}
          >
            {spec.tags.find((option) => option.id === tag.tag)?.label ?? tag.tag}
          </button>
        ))}
        <button className="chip chip-add" onClick={() => setPicking((open) => !open)}>
          {picking ? 'Close' : chosen.length === 0 ? 'Tag it' : '+'}
        </button>
      </div>

      {picking && (
        <div className="picker">
          <input
            className="picker-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${spec.label.toLowerCase()}`}
            aria-label={`Search ${spec.label}`}
          />
          <p className="picker-hint">{spec.hint}</p>
          <div className="picker-grid">
            {matches.map((tag) => (
              <button
                key={tag.id}
                className="picker-option"
                data-on={ids.includes(tag.id)}
                onClick={() => toggle(tag.id)}
              >
                <b>{tag.label}</b>
                <span>{tag.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
