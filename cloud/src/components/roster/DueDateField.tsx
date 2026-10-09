'use client'

import { format, isValid, parseISO } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { dropDraft, putDraft } from '@/lib/plan-drafts'

type Props = {
  planId: string | null
  value: string | null | undefined
  onCommit: (value: string) => Promise<boolean> | boolean | void
}

function parseDay(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const day = parseISO(value)
  return isValid(day) ? day : undefined
}

/** Due date — button opens a DayPicker calendar; picking saves immediately. */
export default function DueDateField({ planId, value, onCommit }: Props) {
  const saved = value ?? ''
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Date | undefined>(() => parseDay(saved))
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(parseDay(saved))
  }, [saved])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function pick(day: Date | undefined) {
    setSelected(day)
    const next = day ? format(day, 'yyyy-MM-dd') : ''
    if (planId) putDraft(planId, 'plan:due_date', next)
    const ok = await onCommit(next)
    if (ok !== false && planId) dropDraft(planId, 'plan:due_date', next)
    setOpen(false)
  }

  const label = selected ? format(selected, 'd MMM yyyy') : 'Pick a date'

  return (
    <div className="duedate" ref={root}>
      <button
        type="button"
        id="plan-due"
        className="duedate-trigger field"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span data-empty={!selected || undefined}>{label}</span>
        <span className="duedate-chev" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="duedate-pop" role="dialog" aria-label="Pick due date">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(day) => void pick(day)}
            defaultMonth={selected}
          />
          {selected && (
            <button type="button" className="duedate-clear" onClick={() => void pick(undefined)}>
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  )
}
