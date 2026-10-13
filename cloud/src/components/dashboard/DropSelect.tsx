'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuOption = {
  value: string
  label: string
  disabled?: boolean
  /** Options sharing a group render under one small header, in order — the
   *  maison stand-in for <optgroup> (2026-10-13). */
  group?: string
}

/** Sentence case for every menu: first letter up, the rest untouched. */
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

type Place = {
  left: number
  top: number
  width: number
  maxHeight: number
  side: 'up' | 'down'
}

const GAP = 6
const EDGE = 8
const OPT_H = 36
const POP_PAD = 12
const POP_MAX = 320

function placeMenu(rect: DOMRect, optionCount: number, measuredHeight?: number): Place {
  const width = Math.min(Math.max(rect.width, 200), POP_MAX)
  const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE)
  const want = measuredHeight ?? Math.min(optionCount * OPT_H + POP_PAD, POP_MAX)
  const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE
  const spaceAbove = rect.top - GAP - EDGE
  // Prefer below; flip up when the menu will not fit and there is more room above.
  const side: 'up' | 'down' =
    want > spaceBelow && spaceAbove > spaceBelow ? 'up' : 'down'
  const maxHeight = Math.max(120, side === 'up' ? spaceAbove : spaceBelow)
  const height = Math.min(want, maxHeight)
  const top = side === 'up'
    ? Math.max(EDGE, rect.top - GAP - height)
    : rect.bottom + GAP
  return { left, top, width, maxHeight, side }
}

/** A maison dropdown: trigger button plus a dark panel of options. Fixed to
 *  the viewport on open so table scroll containers can never clip it. Opens
 *  up or down from the space around the trigger. Full keyboard support:
 *  arrows move, Enter picks, Escape backs out. */
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
  const [at, setAt] = useState<Place | null>(null)
  const selected = options.findIndex((o) => o.value === value)

  function toggle(next = !open) {
    if (next) {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      setAt(placeMenu(rect, options.length))
      setFocus(selected < 0 ? 0 : selected)
    }
    setOpen(next)
  }

  // After paint, measure the real panel and flip / clamp if the estimate was off.
  useEffect(() => {
    if (!open || !pop.current || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const height = pop.current.scrollHeight
    setAt(placeMenu(rect, options.length, height))
  }, [open, options.length])

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
  }, [open])

  function pick(index: number) {
    const opt = options[index]
    if (!opt || opt.disabled) return
    setOpen(false)
    trigger.current?.focus()
    if (opt.value !== value) onChange(opt.value)
  }

  function stepFocus(from: number, dir: 1 | -1) {
    if (options.length === 0) return from
    let next = from
    for (let i = 0; i < options.length; i++) {
      next = (next + dir + options.length) % options.length
      if (!options[next]?.disabled) return next
    }
    return from
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => stepFocus(f, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => stepFocus(f, -1)) }
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
        <i className="msel-chev" aria-hidden>{at?.side === 'up' && open ? '▴' : '▾'}</i>
      </button>
      {open && at && createPortal(
        <div
          ref={pop}
          role="listbox"
          aria-label={label}
          className="msel-pop"
          data-side={at.side}
          style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.maxHeight }}
          tabIndex={-1}
          onKeyDown={onKey}
        >
          {options.map((o, i) => (
            <Fragment key={o.value + o.label}>
              {o.group && o.group !== options[i - 1]?.group && (
                <div className="msel-group" role="presentation">{cap(o.group)}</div>
              )}
              <button key={o.value + o.label} type="button" role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                disabled={o.disabled}
                data-focus={i === focus || undefined}
                data-on={o.value === value || undefined}
                data-disabled={o.disabled || undefined}
                className="msel-opt"
                onClick={() => pick(i)}
                onPointerMove={() => { if (!o.disabled) setFocus(i) }}>
                <span>{cap(o.label)}</span>
                {o.value === value && !o.disabled && <b className="msel-check" aria-hidden>✓</b>}
              </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
