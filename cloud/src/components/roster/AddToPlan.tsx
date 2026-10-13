'use client'

/**
 * Add one library reel to a model's week, without opening their plan
 * (Geno, 2026-10-13). The Creators tab's Top performers rows wear it: the
 * same two questions the item view's assign bar asks — who, which week —
 * folded into one compact row under the reel someone is already looking at.
 *
 * Models arrive scored for this exact reel (`/api/models?job=`), so the one
 * it actually suits sits first; a model who turned the reel down is shown
 * disabled rather than dropped, the same rule the assign rail keeps.
 */
import { useEffect, useState } from 'react'
import { addDays, currentWeekOf, formatDate } from '@/lib/dates'
import DropSelect from '../dashboard/DropSelect'
import { DECLINE_LABEL, isDeclineCode } from '@/lib/decline'
import type { ModelFit } from './types'

const blocked = (fit: ModelFit) => Boolean(fit.declined_code || fit.declined_reason)

/** Why she is blocked, in her own words where she gave any. */
function saidNo(fit: ModelFit): string {
  const said = isDeclineCode(fit.declined_code) ? DECLINE_LABEL[fit.declined_code] : null
  return ['They turned this reel down', said, fit.declined_reason].filter(Boolean).join(' — ')
}

export default function AddToPlan({ jobId, onAdded }: { jobId: string; onAdded?: () => void }) {
  const [open, setOpen] = useState(false)
  /** Null until the roster is read; [] when the read failed. */
  const [fits, setFits] = useState<ModelFit[] | null>(null)
  const [modelId, setModelId] = useState('')
  const [weekOf, setWeekOf] = useState(() => currentWeekOf())
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!open || fits !== null) return
    let gone = false
    // Two reads: who the reel actually suits (scored, best first) and the
    // full active roster to fall back on — an untagged model scores nothing
    // and would otherwise vanish from the list entirely.
    Promise.all([
      fetch('/api/models').then((response) => (response.ok ? response.json() : { models: [] })),
      fetch(`/api/models?job=${encodeURIComponent(jobId)}`).then((response) => (response.ok ? response.json() : { models: [] })),
    ])
      .then(([roster, scored]) => {
        if (gone) return
        const active: { id: string; name: string }[] = (Array.isArray(roster.models) ? roster.models : [])
          .filter((model: { status?: string }) => model.status === 'active')
          .map((model: { id: string; name: string }) => ({ id: model.id, name: model.name }))
        const ranked: ModelFit[] = (Array.isArray(scored.models) ? scored.models : [])
          .filter((fit: ModelFit) => active.some((model) => model.id === fit.id))
        const seen = new Set(ranked.map((fit) => fit.id))
        const list: ModelFit[] = [
          ...ranked,
          ...active
            .filter((model) => !seen.has(model.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((model) => ({ ...model, fit: 0, matched: [] })),
        ]
        setFits(list)
        setModelId((current) => current || list.find((fit) => !blocked(fit))?.id || '')
      })
      .catch(() => { if (!gone) setFits([]) })
    return () => { gone = true }
  }, [open, fits, jobId])

  async function add() {
    if (!modelId || busy) return
    setBusy(true)
    setNote(null)
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, week_of: weekOf, job_id: jobId }),
    }).catch(() => null)
    const body = await response?.json().catch(() => ({})) ?? {}
    setBusy(false)
    if (!response?.ok) {
      setNote(body.error ?? 'That did not go through.')
      return
    }
    const name = fits?.find((fit) => fit.id === modelId)?.name ?? 'their'
    setAdded((current) => new Set(current).add(modelId))
    setNote(body.added > 0
      ? `On ${name}'s week, with a drafted brief.`
      : `Already on ${name}'s week.`)
    onAdded?.()
  }

  if (!open) {
    return (
      <button type="button" className="addplan-open" onClick={() => setOpen(true)}>
        + Add to plan
      </button>
    )
  }

  const picked = fits?.find((fit) => fit.id === modelId) ?? null

  return (
    <div className="addplan" role="group" aria-label="Add to a plan">
      <div className="addplan-row">
        <DropSelect
          label="Model"
          value={modelId}
          onChange={setModelId}
          options={fits === null
            ? [{ value: '', label: 'Loading the roster…', disabled: true }]
            : fits.map((fit) => ({
                value: fit.id,
                label: blocked(fit) ? `${fit.name} — said no` : fit.name,
                disabled: blocked(fit),
              }))}
        />
        <DropSelect
          label="Week"
          value={weekOf}
          onChange={setWeekOf}
          options={[currentWeekOf(), addDays(currentWeekOf(), 7)].map((week, index) => ({
            value: week,
            label: `${index === 0 ? 'This week' : 'Next week'} · ${formatDate(week)}`,
          }))}
        />
        <button type="button" className="btn btn-small" disabled={busy || !modelId} onClick={() => void add()}>
          {busy ? 'Adding…' : added.has(modelId) ? 'Add again' : 'Add'}
        </button>
        <button type="button" className="addplan-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
      </div>
      {picked && blocked(picked) && (
        <span className="hint" title={saidNo(picked)}>
          They turned this reel down — it will not land on their week.
        </span>
      )}
      {note && <span className="hint" role="status">{note}</span>}
    </div>
  )
}
