'use client'

import { useState } from 'react'
import { INACTIVE_REASONS, MAX_INACTIVE_NOTE, reasonLabel, type InactiveReason } from '@/lib/inactive'
import { shortDay } from '../../dashboard/format'

export type ActiveState = {
  status: 'active' | 'paused'
  inactive_reason: string | null
  inactive_note: string | null
  inactive_since: string | null
}

/**
 * Deactivate her with a reason, or bring her back (lib/inactive.ts). Saves on
 * the tap. Deactivating asks why first, so a greyed-out card always says so.
 */
export default function ActiveControl({ modelId, name, state, onChange }: {
  modelId: string
  name: string
  state: ActiveState
  onChange: (next: ActiveState) => void
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState<InactiveReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/models/${modelId}/active`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => null)
    setBusy(false)
    const json = await response?.json().catch(() => null)
    if (!response?.ok) { setError(json?.error ?? 'That did not save. Nothing changed.'); return }
    setAsking(false)
    setReason(null)
    setNote('')
    onChange({
      status: json.status, inactive_reason: json.inactive_reason ?? null,
      inactive_note: json.inactive_note ?? null, inactive_since: json.inactive_since ?? null,
    })
  }

  if (state.status === 'paused') {
    return (
      <div className="active-ctl" data-inactive="true">
        <p className="active-why">
          <b>Inactive · {reasonLabel(state.inactive_reason)}</b>
          {state.inactive_since && <> since {shortDay(state.inactive_since.slice(0, 10))}</>}
          {state.inactive_note && <> — {state.inactive_note}</>}
        </p>
        <button className="chip active-back" disabled={busy} onClick={() => void save({ active: true })}>
          {busy ? 'Reactivating…' : 'Reactivate'}
        </button>
        {error && <p className="active-error" role="alert">{error}</p>}
      </div>
    )
  }

  if (!asking) {
    return (
      <div className="active-ctl">
        <button className="chip active-off" onClick={() => setAsking(true)}>Deactivate</button>
      </div>
    )
  }

  return (
    <div className="active-ctl" data-asking="true">
      <p className="active-q">Why is {name} inactive? Plans, shout-outs and earnings messages stop until you reactivate her. Nothing is deleted.</p>
      <div className="chips" role="group" aria-label="Reason">
        {INACTIVE_REASONS.map((r) => (
          <button key={r.key} className="chip" data-on={reason === r.key} aria-pressed={reason === r.key} onClick={() => setReason(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      <label className="active-note">
        <span className="sr-only">Note</span>
        <input
          value={note}
          maxLength={MAX_INACTIVE_NOTE}
          placeholder={reason === 'other' ? 'What happened? (needed for Other)' : 'Note (optional)'}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="active-actions">
        <button className="chip active-confirm" disabled={!reason || busy || (reason === 'other' && !note.trim())}
          onClick={() => void save({ active: false, reason, note })}>
          {busy ? 'Saving…' : 'Deactivate'}
        </button>
        <button className="chip" onClick={() => { setAsking(false); setError(null) }}>Cancel</button>
      </div>
      {error && <p className="active-error" role="alert">{error}</p>}
    </div>
  )
}
