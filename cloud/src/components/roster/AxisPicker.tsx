'use client'

import { useState } from 'react'
import { taxonomy, type Axis } from '@/lib/taxonomy'

/** One axis of the taxonomy, ticked off against a model. Same vocabulary the
 *  library tags videos with, which is the whole point — it is what lets the two
 *  sides find each other. Uncapped: as many as actually apply. */
export default function AxisPicker({
  title,
  axis,
  chosen,
  hint,
  tone,
  onChange,
}: {
  title: string
  axis: Axis
  chosen: string[]
  hint: string
  tone?: 'refuse'
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const options = taxonomy[axis].tags
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((tag) => tag !== id) : [...chosen, id])

  return (
    <div className="axis" data-tone={tone}>
      <div className="axis-head">
        <span className="axis-name">{title}</span>
        <button className="axis-confirm" onClick={() => setOpen((shown) => !shown)}>
          {open ? 'Done' : chosen.length > 0 ? `Edit · ${chosen.length}` : 'Choose'}
        </button>
      </div>
      <div className="chips">
        {chosen.map((tag) => (
          <button
            key={tag}
            className="chip"
            data-origin={tone === 'refuse' ? undefined : 'human'}
            data-refuse={tone === 'refuse' || undefined}
            onClick={() => toggle(tag)}
          >
            {options.find((option) => option.id === tag)?.label ?? tag}
          </button>
        ))}
        {chosen.length === 0 && !open && <span className="hint">{hint}</span>}
      </div>
      {open && (
        <div className="picker">
          <div className="picker-grid">
            {options.map((tag) => (
              <button
                key={tag.id}
                className="picker-option"
                data-on={chosen.includes(tag.id)}
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
