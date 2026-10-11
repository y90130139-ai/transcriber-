'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cap, type MenuOption } from './DropSelect'

export type MultiSection = {
  label: string
  options: MenuOption[]
  mode?: 'multiple' | 'single'
}

/** A multi-pick menu: same panel language as DropSelect, but options toggle
 *  with checkboxes and the panel stays open while picking. The trigger wears
 *  the count. Optional sections group related filters; single sections behave
 *  like radio groups while multiple sections keep their independent checks.
 *  Fixed to the viewport so scroll containers never clip it. */
export default function DropMulti({ values, options = [], sections, onChange, label, summary, count, clearable }: {
  values: string[]
  options?: MenuOption[]
  sections?: MultiSection[]
  onChange: (next: string[]) => void
  label: string
  summary: string
  /** Override the selected-value count when defaults should not read as active filters. */
  count?: number
  /** Override when selected defaults are present but Clear all should stay hidden. */
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)
  const entries = sections
    ? sections.flatMap((section) => section.options.map((option) => ({ option, section })))
    : options.map((option) => ({ option, section: null }))
  const menuOptions = entries.map((entry) => entry.option)
  const activeCount = count ?? values.length
  const canClear = clearable ?? values.length > 0

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
    const entry = entries[index]
    const option = entry?.option
    if (!option) return
    const selected = values.includes(option.value)
    const singleOptions = entry.section?.mode === 'single'
      ? new Set(entry.section.options.map((candidate) => candidate.value))
      : null
    onChange(selected
      ? values.filter((value) => value !== option.value)
      : [...values.filter((value) => !singleOptions?.has(value)), option.value])
  }

  function stepFocus(from: number, direction: 1 | -1) {
    const count = menuOptions.length + (canClear ? 1 : 0)
    if (count === 0) return from
    return (from + direction + count) % count
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => stepFocus(f, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => stepFocus(f, -1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (canClear && focus === menuOptions.length) onChange([])
      else flip(focus)
    }
  }

  useEffect(() => {
    pop.current?.querySelector<HTMLElement>(`[data-focus='true']`)?.scrollIntoView({ block: 'nearest' })
  }, [focus, open])

  const renderOption = (option: MenuOption, index: number) => {
    const on = values.includes(option.value)
    return (
      <button key={option.value} type="button" role="option"
        aria-selected={on} aria-disabled={option.disabled || undefined}
        disabled={option.disabled} data-focus={index === focus || undefined}
        data-on={on || undefined} data-disabled={option.disabled || undefined}
        className="msel-opt" onClick={() => flip(index)}
        onPointerMove={() => { if (!option.disabled) setFocus(index) }}>
        <span>{cap(option.label)}</span>
        {on && <b className="msel-check" aria-hidden>✓</b>}
      </button>
    )
  }

  return (
    <>
      <button ref={trigger} type="button" className="msel-trigger" data-open={open || undefined}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => toggle()}>
        <span>{cap(summary)}{activeCount > 0 && <b> · {activeCount}</b>}</span>
        <i className="msel-chev" aria-hidden>▾</i>
      </button>
      {open && at && createPortal(
        <div ref={pop} role="listbox" aria-label={label} aria-multiselectable="true" className="msel-pop"
          style={{ left: at.left, top: at.top, width: at.width }}
          tabIndex={-1} onKeyDown={onKey}>
          {canClear && (
            <button type="button" className="msel-clear" data-focus={focus === menuOptions.length || undefined}
              onClick={() => { onChange([]); setOpen(false) }}
              onPointerMove={() => setFocus(menuOptions.length)}>
              Clear all
            </button>
          )}
          {sections
            ? sections.map((section) => {
                const start = entries.findIndex((entry) => entry.section === section)
                return (
                  <div key={section.label} className="msel-section" role="group" aria-label={section.label}>
                    <div className="msel-section-title">{cap(section.label)}</div>
                    {section.options.map((option, index) => renderOption(option, start + index))}
                  </div>
                )
              })
            : menuOptions.map(renderOption)}
        </div>,
        document.body,
      )}
    </>
  )
}
