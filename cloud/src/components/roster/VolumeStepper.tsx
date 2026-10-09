'use client'

import { useEffect, useRef, useState } from 'react'
import { dropDraft, putDraft } from '@/lib/plan-drafts'

type Props = {
  planId: string | null
  /** Saved plan target — null/empty means “use their usual”. */
  value: number | null | undefined
  /** Their standing weekly target — shown as the empty placeholder. */
  usual: number
  onCommit: (value: number) => Promise<boolean> | boolean | void
}

const MIN = 0
const MAX = 200
const SAVE_AFTER_MS = 900

/** Videos wanted — minus / number / plus, or type the number. */
export default function VolumeStepper({ planId, value, usual, onCommit }: Props) {
  const saved = value == null || value === 0 ? '' : String(value)
  const [text, setText] = useState(saved)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sent = useRef(saved)
  const latest = useRef({ text, onCommit, planId })
  latest.current = { text, onCommit, planId }

  useEffect(() => {
    if (focused.current) return
    setText(saved)
    sent.current = saved
  }, [saved])

  const commit = async (next: string) => {
    const { onCommit: save, planId: id } = latest.current
    if (next === sent.current) {
      if (id) dropDraft(id, 'plan:target', next)
      return
    }
    sent.current = next
    const n = next === '' ? 0 : Math.max(MIN, Math.min(MAX, Number(next) || 0))
    const ok = await save(n)
    if (ok !== false && id) dropDraft(id, 'plan:target', next === '' ? '' : String(n))
    if (ok === false) sent.current = '\0'
  }

  const schedule = (next: string) => {
    setText(next)
    if (planId) putDraft(planId, 'plan:target', next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void commit(latest.current.text)
    }, SAVE_AFTER_MS)
  }

  const shown = text === '' ? usual : Math.max(MIN, Math.min(MAX, Number(text) || 0))

  function step(delta: number) {
    const base = text === '' ? usual : Number(text) || 0
    const next = Math.max(MIN, Math.min(MAX, base + delta))
    focused.current = false
    schedule(String(next))
    void commit(String(next))
  }

  return (
    <div className="volstep" role="group" aria-label="Videos wanted this week">
      <button
        type="button"
        className="volstep-btn"
        aria-label="One fewer"
        disabled={shown <= MIN}
        onClick={() => step(-1)}
      >
        −
      </button>
      <input
        id="plan-target"
        className="volstep-input field"
        type="number"
        min={MIN}
        max={MAX}
        inputMode="numeric"
        value={text}
        placeholder={String(usual)}
        aria-label="Videos wanted this week"
        onFocus={() => { focused.current = true }}
        onChange={(event) => schedule(event.target.value)}
        onBlur={() => {
          focused.current = false
          if (timer.current) {
            clearTimeout(timer.current)
            timer.current = null
          }
          void commit(text)
        }}
      />
      <button
        type="button"
        className="volstep-btn"
        aria-label="One more"
        disabled={shown >= MAX}
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  )
}
