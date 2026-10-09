'use client'

import { useEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { dropDraft, putDraft } from '@/lib/plan-drafts'

/**
 * A plan field that saves itself (Geno, 2026-10-09).
 *
 * Typing is held locally and sent a beat after it stops — and again on blur,
 * and on the way out when the dialog closes or the tab goes away — so nothing
 * typed depends on remembering to click somewhere else first. Every keystroke
 * is also kept on the device (lib/plan-drafts) until a save of that exact
 * value lands, which is what the "Restore" banner reads from.
 *
 * The box follows the saved value only while it is not being typed in: a
 * reload landing mid-sentence never yanks the text out from under the cursor.
 */

const SAVE_AFTER_MS = 900
/** Matches no typed value, so the next blur tries a failed save again. */
const FAILED = '\u0000'

/** Every field with an unsent edit — flushed when the page is hidden. */
const unsent = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { for (const flush of [...unsent]) flush() })
}

type Shared = {
  /** The saved value, from the server. */
  value: string | null | undefined
  /** Save it. Resolve true once the server has it. */
  onCommit: (value: string) => Promise<boolean> | boolean | void
  /** The week the draft is kept under, and this field's name within it. */
  planId: string | null
  field: string
}

type InputProps = Shared & { multiline?: false } &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'>
type AreaProps = Shared & { multiline: true } &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'>

export default function AutoField(props: InputProps | AreaProps) {
  const { value, onCommit, planId, field, multiline, ...rest } = props
  const saved = value ?? ''
  const [text, setText] = useState(saved)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The last value sent, so a blur right after an autosave is not a repeat. */
  const sent = useRef(saved)
  const latest = useRef({ text, onCommit, planId, field })
  latest.current = { text, onCommit, planId, field }

  useEffect(() => {
    if (focused.current) return
    setText(saved)
    sent.current = saved
  }, [saved])

  const commit = useRef(async (next: string) => {
    const { onCommit: save, planId: id, field: name } = latest.current
    if (next === sent.current) {
      if (id) dropDraft(id, name, next)
      return
    }
    sent.current = next
    const ok = await save(next)
    if (ok !== false && id) dropDraft(id, name, next)
    if (ok === false) sent.current = FAILED
  }).current

  const flush = useRef(() => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    unsent.delete(flush)
    void commit(latest.current.text)
  }).current

  // Closing the dialog mid-sentence still saves the sentence.
  useEffect(() => flush, [flush])

  function change(next: string) {
    setText(next)
    if (planId) putDraft(planId, field, next)
    if (timer.current) clearTimeout(timer.current)
    unsent.add(flush)
    timer.current = setTimeout(() => {
      timer.current = null
      unsent.delete(flush)
      void commit(next)
    }, SAVE_AFTER_MS)
  }

  function blur(next: string) {
    focused.current = false
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      unsent.delete(flush)
    }
    void commit(next)
  }

  if (multiline) {
    return (
      <textarea
        {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        value={text}
        onFocus={() => { focused.current = true }}
        onChange={(event) => change(event.target.value)}
        onBlur={(event) => blur(event.target.value)}
      />
    )
  }
  return (
    <input
      {...(rest as InputHTMLAttributes<HTMLInputElement>)}
      value={text}
      onFocus={() => { focused.current = true }}
      onChange={(event) => change(event.target.value)}
      onBlur={(event) => blur(event.target.value)}
    />
  )
}
