'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cap, type MenuOption } from './DropSelect'

/** A multi-pick menu: same panel language as DropSelect, but options toggle
 *  with checkboxes and the panel stays open while picking. The trigger wears
 *  the count. Fixed to the viewport so scroll containers never clip it. */
export default function DropMulti({ values, options, onChange, label, summary }: {
  values: string[]
  options: MenuOption[]
  onChange: (next: string[]) => void
  label: string
  summary: string
}) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)

  function toggle(next = !open) {
    if (next) {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      setAt({
        left: Math.min(rect.left, window.innerWidth - Math.min(Math.max(rect.width, 240), 360) - 8),
        top: rect.bottom + 6,
        width: Math.max(rect.width, 240),
      })
      setFocus(0)
    }
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) close()
    }
    // Capture phase so any container's scroll closes the menu; the popup's own
    // scroll (the focused option is scrolled into view on open) is not that.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && pop.current?.contains(e.target)) return
      close()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function flip(index: number) {
    const option = options[index]
    if (!option) return
    onChange(values.includes(option.value)
      ? values.filter((v) => v !== option.value)
      : [...values, option.value])
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => (f + 1) % (options.length + (values.length ? 1 : 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => (f - 1 + options.length + (values.length ? 1 : 0)) % (options.length + (values.length ? 1 : 0))) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (values.length && focus === options.length) onChange([])
      else flip(focus)
    }
  }

  useEffect(() => {
    pop.current?.querySelector<HTMLElement>(`[data-focus='true']`)?.scrollIntoView({ block: 'nearest' })
  }, [focus, open])

  return (
    <>
      <button ref={trigger} type="button" className="msel-trigger" data-open={open || undefined}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => toggle()}>
        <span>{cap(summary)}{values.length > 0 && <b> · {values.length}</b>}</span>
        <i className="msel-chev" aria-hidden>▾</i>
      </button>
      {open && at && createPortal(
        <div ref={pop} role="listbox" aria-label={label} aria-multiselectable="true" className="msel-pop"
          style={{ left: at.left, top: at.top, width: at.width }}
          tabIndex={-1} onKeyDown={onKey}>
          {values.length > 0 && (
            <button type="button" className="msel-clear" data-focus={focus === options.length || undefined}
              onClick={() => { onChange([]); setOpen(false) }}
              onPointerMove={() => setFocus(options.length)}>
              Clear all
            </button>
          )}
          {options.map((o, i) => {
            const on = values.includes(o.value)
            return (
              <button key={o.value} type="button" role="option"
                aria-selected={on} data-focus={i === focus || undefined} data-on={on || undefined}
                className="msel-opt" onClick={() => flip(i)} onPointerMove={() => setFocus(i)}>
                <span>{cap(o.label)}</span>
                {on && <b className="msel-check" aria-hidden>✓</b>}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
