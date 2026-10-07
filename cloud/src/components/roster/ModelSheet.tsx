'use client'

import { useEffect, useState } from 'react'
import ModelProfile, { type ProfileTab } from './ModelProfile'
import { useStanding } from './useStanding'
import type { RosterModel } from './types'

/** Her profile sheet, opened over whatever page asked for it — the roster,
 *  the dashboard, Today. The page itself never navigates away. */
export default function ModelSheet({ modelId, initialTab = 'profile', onClose, onSaved }: {
  modelId: string
  initialTab?: ProfileTab
  onClose: () => void
  onSaved?: () => void
}) {
  const [model, setModel] = useState<RosterModel | null>(null)
  const [missing, setMissing] = useState(false)
  const { standing, reload } = useStanding()

  useEffect(() => {
    let live = true
    fetch('/api/models')
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((body) => {
        if (!live) return
        const found = (body.models ?? []).find((one: RosterModel) => one.id === modelId) ?? null
        if (found) setModel(found)
        else setMissing(true)
      })
      .catch(() => { if (live) setMissing(true) })
    return () => { live = false }
  }, [modelId])

  if (missing) return null
  if (!model) return null

  return (
    <ModelProfile
      model={model}
      initialTab={initialTab}
      onClose={onClose}
      onSaved={() => { onSaved?.(); onClose() }}
      onStanding={() => void reload()}
      standing={standing[modelId]}
    />
  )
}
