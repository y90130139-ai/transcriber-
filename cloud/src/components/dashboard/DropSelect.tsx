'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuOption = { value: string; label: string }

/** Sentence case for every menu: first letter up, the rest untouched. */
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** A maison dropdown: trigger button plus a dark panel of options. Fixed to
 *  the viewport on open so table scroll containers can never clip it. Full
 *  keyboard support: arrows move, Enter picks, Escape backs out. */
export default function DropSelect({ value, options, onChange, label, id, disabled, placeholder, className }: {
  value: string
  options: MenuOption[]
  onChange: (next: string) => void
  label: string
  /** The trigger's id, so a real <label htmlFor> can still point at it. */
  id?: string
  disabled?: boolean
  /** Shown on the trigger while no option matches the value — an action
   *  menu (pick a week, move a card) has a verb there, not a value. */
  placeholder?: string
  /** Extra classes for the trigger, for hosts with their own pills. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)
  const selected = options.findIndex((o) => o.value === value)

  function toggle(next = !open) {
    if (next) {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      setAt({
        left: Math.min(rect.left, window.innerWidth - Math.min(Math.max(rect.width, 200), 320) - 8),
        top: rect.bottom + 6,
        width: Math.max(rect.width, 200),
      })
      setFocus(selected < 0 ? 0 : selected)
    }
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) close()
    }
    // Capture phase, so scrolling any container closes the menu — it is fixed
    // to the viewport and would otherwise drift away from its trigger. But the
    // popup's own scroll is not that: on open the selected option is scrolled
    // into view, and a capture listener saw that too — closing every menu the
    // moment it opened (2026-10-07).
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
  }, [open ])

  function pick(index: number) {
    setOpen(false)
    trigger.current?.focus()
    if (options[index] && options[index].value !== value) onChange(options[index].value)
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => (f + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => (f - 1 + options.length) % options.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(focus) }
  }

  useEffect(() => {
    pop.current?.querySelector<HTMLElement>(`[data-focus='true']`)?.scrollIntoView({ block: 'nearest' })
  }, [focus, open])

  return (
    <>
      <button ref={trigger} type="button"
        className={className ? `msel-trigger ${className}` : 'msel-trigger'}
        id={id} disabled={disabled} data-open={open || undefined}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => toggle()}>
        <span>{cap(selected < 0 ? placeholder || value : options[selected].label)}</span>
        <i className="msel-chev" aria-hidden>▾</i>
      </button>
      {open && at && createPortal(
        <div ref={pop} role="listbox" aria-label={label} className="msel-pop"
          style={{ left: at.left, top: at.top, width: at.width }}
          tabIndex={-1} onKeyDown={onKey}>
          {options.map((o, i) => (
            <button key={o.value + o.label} type="button" role="option"
              aria-selected={o.value === value} data-focus={i === focus || undefined} data-on={o.value === value || undefined}
              className="msel-opt" onClick={() => pick(i)} onPointerMove={() => setFocus(i)}>
              <span>{cap(o.label)}</span>
              {o.value === value && <b className="msel-check" aria-hidden>✓</b>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
