'use client'

import { useCallback, useEffect, useState } from 'react'
import CollisionFlag from './CollisionFlag'
import ModelWeekPicker, { assignableWeeks } from './ModelWeekPicker'
import type { Collision } from './types'

const DONE_RESET_MS = 3200

type Choice = { id: string; name: string; status: string }

/**
 * Put a shortlist on one model's week in a single pass.
 *
 * The single-item path already exists and works: open a library item and
 * `AssignBar` picks a model and week, creates the plan if it is missing, drafts
 * the brief on the way in and shows per-model fit beside the picker. This does
 * not replace any of that. What was missing was only the bulk path — the
 * multi-select bar offered `Download videos` and nothing else, so shortlisting
 * six reels for one week was six open-assign-close cycles.
 *
 * The collision warning is checked before anything is committed, not after: the
 * whole point of knowing another creator already has a reel is knowing it while
 * you can still change your mind.
 */
export default function BulkAssign({
  jobIds,
  onAdded,
}: {
  jobIds: string[]
  onAdded: () => void
}) {
  const [models, setModels] = useState<Choice[]>([])
  const [modelId, setModelId] = useState('')
  const [weekOf, setWeekOf] = useState(() => assignableWeeks()[0])
  const [collisions, setCollisions] = useState<Record<string, Collision[]>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/models')
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((body) => {
        const active = (body.models ?? []).filter((model: Choice) => model.status === 'active')
        setModels(active)
        setModelId((current) => current || (active[0]?.id ?? ''))
      })
      .catch(() => setModels([]))
  }, [])

  // Re-asked whenever the selection or the target changes, because both change
  // the answer: a reel is not a collision with the model who is about to get it.
  const check = useCallback(async () => {
    if (jobIds.length === 0) { setCollisions({}); return }
    const query = `jobs=${encodeURIComponent(jobIds.join(','))}&model=${encodeURIComponent(modelId)}`
    const response = await fetch(`/api/plans?${query}`)
    if (!response.ok) return
    const body = await response.json()
    setCollisions(body.collisions ?? {})
  }, [jobIds, modelId])

  useEffect(() => { void check() }, [check])

  async function add() {
    if (!modelId || jobIds.length === 0) return
    setBusy(true)
    setNote(null)

    // The plan first — created if this week has none — then everything at once.
    const planned = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, week_of: weekOf }),
    })
    const plan = await planned.json().catch(() => ({}))
    if (!planned.ok || !plan.plan?.id) {
      setBusy(false)
      setNote({ text: plan.error ?? 'Could not open that week.', bad: true })
      return
    }

    const response = await fetch(`/api/plans/${plan.plan.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_ids: jobIds }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)

    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not add those.', bad: true })
      return
    }
    const added = Number(body.added ?? 0)
    setNote({
      text: added === jobIds.length
        ? `${added} on their week, each with a drafted brief.`
        : `${added} added · ${jobIds.length - added} already on that week.`,
    })
    onAdded()
    setTimeout(() => setNote(null), DONE_RESET_MS)
  }

  if (models.length === 0) return null

  const clashing = Object.keys(collisions).length
  // One line per model-and-week, not one per reel — six reels all sitting on
  // Ella's week is one fact about Ella, said once.
  const whoElse = [...new Map(
    Object.values(collisions).flat().map((other) => [`${other.model_id}|${other.week_of}`, other]),
  ).values()]

  return (
    <div className="bulkassign">
      <ModelWeekPicker
        models={models}
        modelId={modelId}
        weekOf={weekOf}
        onModel={setModelId}
        onWeek={setWeekOf}
      />
      <button className="btn btn-small" onClick={() => void add()} disabled={busy || !modelId}>
        {busy ? 'Adding' : `Add ${jobIds.length} to their week`}
      </button>

      {/* Warned before committing, never blocked — two creators on one trend is
          sometimes exactly what is wanted. */}
      {clashing > 0 && (
        <span className="bulkassign-clash">
          <span className="hint">
            {clashing} of {jobIds.length} already on someone else&rsquo;s week
          </span>
          <CollisionFlag on={whoElse} />
        </span>
      )}

      {note && <span className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</span>}
    </div>
  )
}
