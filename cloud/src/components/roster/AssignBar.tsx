'use client'

import { useEffect, useState } from 'react'
import { currentWeekOf } from '@/lib/dates'
import ModelWeekPicker from './ModelWeekPicker'
import { labelOf } from '@/lib/taxonomy'
import { DECLINE_LABEL, isDeclineCode } from '@/lib/decline'
import type { ModelFit } from './types'

const DONE_RESET_MS = 2400

type Choice = { id: string; name: string; week_items: number }

/**
 * Tag the video you are looking at to one of our models.
 *
 * One control, appended to the item view: pick her, pick a week, and the plan
 * is created if it does not exist yet. The brief is drafted on the way in, so
 * the item never lands blank.
 */
/** Why she is blocked, in her own words where she gave any. */
function declinedTitle(fit: ModelFit): string | null {
  if (!fit.declined_code && !fit.declined_reason) return null
  const said = isDeclineCode(fit.declined_code) ? DECLINE_LABEL[fit.declined_code] : null
  return ['They turned this reel down', said, fit.declined_reason].filter(Boolean).join(' — ')
}

export default function AssignBar({ jobId }: { jobId: string }) {
  const [models, setModels] = useState<Choice[]>([])
  const [modelId, setModelId] = useState('')
  const [weekOf, setWeekOf] = useState(() => currentWeekOf())
  const [fits, setFits] = useState<ModelFit[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/models')
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((body) => {
        const active = (body.models ?? []).filter((model: { status: string }) => model.status === 'active')
        setModels(active)
        setModelId((current) => current || (active[0]?.id ?? ''))
      })
      .catch(() => setModels([]))

    // Who this video actually suits, scored against each model's own tags.
    fetch(`/api/models?job=${encodeURIComponent(jobId)}`)
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((body) => setFits(body.models ?? []))
      .catch(() => setFits([]))
  }, [jobId])

  async function assign() {
    if (!modelId) return
    setBusy(true)
    setNote(null)
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, week_of: weekOf, job_id: jobId }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy(false)

    if (!response.ok) {
      setNote({ text: body.error ?? 'Could not add that.', bad: true })
      return
    }
    // One video often belongs on two models' weeks, so adding does not reset
    // the bar — it marks that one done and leaves the rest reachable.
    setAdded((current) => new Set(current).add(modelId))
    setNote({
      text: body.added > 0 ? 'On their plan, with a drafted brief.' : 'Already on that week.',
    })
    setTimeout(() => setNote(null), DONE_RESET_MS)
  }

  if (models.length === 0) return null

  return (
    <div className="assignbar">
      <span className="axis-name">Put it on a plan</span>

      {fits.length > 0 && (
        <div className="fitrail">
          {fits.map((fit) => (
            <button
              key={fit.id}
              className="chip"
              data-on={modelId === fit.id}
              data-done={added.has(fit.id) || undefined}
              // She said no to this exact reel. Left visible and unpressable:
              // a name that simply vanished from the rail reads as a bug, and
              // the useful thing is knowing she was asked and said no.
              data-declined={fit.declined_code || fit.declined_reason ? true : undefined}
              disabled={Boolean(fit.declined_code || fit.declined_reason)}
              onClick={() => setModelId(fit.id)}
              title={declinedTitle(fit) ?? fit.matched.join(', ')}
            >
              {added.has(fit.id) ? '✓ ' : ''}{fit.name}
              {fit.declined_code || fit.declined_reason ? (
                <em> said no</em>
              ) : fit.matched.length > 0 && (
                <em> {fit.matched.slice(0, 2).map((tag) => labelOf('format', tag)).join(', ')}</em>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="assignbar-row">
        {/* The same two controls the library's bulk bar offers, from one place. */}
        <ModelWeekPicker
          models={models}
          modelId={modelId}
          weekOf={weekOf}
          onModel={setModelId}
          onWeek={setWeekOf}
        />
        <button className="btn btn-small" onClick={assign} disabled={busy || !modelId}>
          {busy ? 'Adding' : 'Add'}
        </button>
      </div>
      {note && <span className="hint" data-tone={note.bad ? 'bad' : undefined}>{note.text}</span>}
    </div>
  )
}
