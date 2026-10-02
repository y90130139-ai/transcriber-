'use client'

import { useCallback, useEffect, useState } from 'react'
import { DAY_SHORT } from '@/lib/dates'
import { labelOf } from '@/lib/taxonomy'

type Row = {
  id: string | null
  created_at: string | null
  sent_at: string | null
  send_error: string | null
  reminded_at: string | null
  opened_at: string | null
  submitted_at: string | null
  lang: 'en' | 'es' | null
  answers: { per_day: number; weekly: number; days: number[]; times: string[]; formats: string[]; wont: string[]; personas: string[]; busy: string } | null
  changes: { field: string; from: unknown; to: unknown }[] | null
  priority: string | null
  best_times: string[]
  daily_capacity: number | null
  in_group: boolean
}

const BUSY = { ahead: 'Films ahead', catchup: 'Catches up later', skip: 'Skips the week' } as Record<string, string>
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

function stateLine(s: Row): string {
  if (!s.id) return 'Not sent yet.'
  if (s.submitted_at) return `Answered ${when(s.submitted_at)}${s.lang === 'es' ? ' (in Spanish)' : ''} — priority ${s.priority}.`
  if (s.send_error) return `Could not post it: ${s.send_error}`
  if (s.opened_at) return `Opened ${when(s.opened_at)}, not finished yet.`
  if (s.reminded_at) return `Sent ${when(s.sent_at)}, reminded ${when(s.reminded_at)}.`
  if (s.sent_at) return `Sent ${when(s.sent_at)}. One reminder goes after 3 days.`
  return 'Queued — the bot posts it in her MARKETING topic within a minute.'
}

/** Her questionnaire: send it, see where it stands, see what she said and
 *  what it changed on her profile (lib/survey). */
export default function SurveyPanel({ modelId }: { modelId: string }) {
  const [s, setS] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/models/${modelId}/survey`)
    if (response.ok) setS((await response.json()).survey)
  }, [modelId])

  useEffect(() => { void load() }, [load])

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/models/${modelId}/survey`, { method: 'POST' })
      if (!response.ok) throw new Error()
      await load()
    } catch {
      setError('Could not queue it. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  if (!s) return null
  const open = s.id && !s.submitted_at && !s.send_error
  const a = s.answers

  return (
    <section className="form-row survey-panel" aria-label="Creator questionnaire">
      <span className="axis-name">Creator questionnaire</span>
      <p className="hint">{stateLine(s)}</p>
      {error && <p className="hint" data-tone="bad">{error}</p>}
      {!s.in_group && <p className="hint">Link her Telegram group first — the bot posts it there.</p>}
      <div className="chips">
        <button className="btn btn-small" disabled={busy || Boolean(open) || !s.in_group} onClick={() => void send()}>
          {s.submitted_at ? 'Send again' : s.send_error ? 'Try again' : 'Send questionnaire'}
        </button>
      </div>
      {a && (
        <dl className="survey-answers">
          <dt>Volume</dt><dd>{a.per_day} a filming day · {a.weekly} a week</dd>
          <dt>Days</dt><dd>{a.days.map((d) => DAY_SHORT[d]).join(', ')}</dd>
          <dt>Best times</dt><dd>{a.times.join(', ')}</dd>
          <dt>Makes</dt><dd>{a.formats.map((f) => labelOf('format', f)).join(', ')}</dd>
          {a.wont.length > 0 && <><dt>Won’t do</dt><dd>{a.wont.map((f) => labelOf('format', f)).join(', ')}</dd></>}
          {a.personas.length > 0 && <><dt>Persona</dt><dd>{a.personas.map((p) => labelOf('persona', p)).join(', ')}</dd></>}
          <dt>Busy week</dt><dd>{BUSY[a.busy] ?? a.busy}</dd>
          {s.changes && s.changes.length > 0 && (
            <><dt>Changed</dt><dd>{s.changes.map((c) => c.field.replace('_', ' ')).join(', ')}</dd></>
          )}
        </dl>
      )}
    </section>
  )
}
