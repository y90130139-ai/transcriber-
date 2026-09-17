'use client'

import { useCallback, useEffect, useState } from 'react'
import PlanView from '@/components/plan/PlanView'
import type { Plan, PlanItem, PlanModel } from '@/lib/plans'
// Her stylesheet, pulled into the console by this component alone.
//
// Safe because every rule in it is scoped under `.plan` except its dark-mode
// `:root` block, which is the same token values globals.css already declares —
// so loading it here changes nothing outside the frame below. Next supports a
// global stylesheet imported from any component in `app/`; see
// node_modules/next/dist/docs/01-app/01-getting-started/11-css.md.
import '@/app/plan.css'

type Payload = { model: PlanModel; plan: Plan; items: PlanItem[] }

/**
 * Her page, inside the console, in a phone.
 *
 * THIS IS NOT A MOCK-UP OF HER PAGE. It is `PlanView` — the same component the
 * `/p/[token]` route renders — fed from the same query by way of
 * `/api/plans/[id]/preview`. There is no second implementation to keep in
 * sync, which is the whole point: the two surfaces cannot drift apart, because
 * there is only one of them.
 *
 * `preview` is passed all the way down. Every control still responds exactly
 * as it will under her thumb, and not one of them writes. See PlanItemCard's
 * note on why that matters more here than it sounds: the console previews real
 * creators' live weeks, and a preview that posted would tick her cards filmed
 * and answer her verdicts from Geno's screen while he was only looking.
 */
export default function PlanPreview({
  planId,
  /** Bumped by the editor whenever it saves. The preview refetches rather than
   *  mirroring the editor's local state — what it must show is what is stored,
   *  because that is what her page will load. A field typed and not yet blurred
   *  has not been saved and must not appear here as though it had. */
  revision,
}: {
  planId: string
  revision: number
}) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/plans/${planId}/preview`).catch(() => null)
    if (!response?.ok) {
      setFailed(true)
      return
    }
    setFailed(false)
    setPayload(await response.json().catch(() => null))
  }, [planId])

  useEffect(() => { void load() }, [load, revision])

  if (failed) {
    return <p className="planpane-note">The preview could not load. Her link itself is unaffected.</p>
  }
  if (!payload) {
    return <p className="planpane-note">Loading her page…</p>
  }

  return (
    <div className="planphone">
      <div className="planphone-screen">
        {/* The token is hers and real, but nothing in preview mode sends it
            anywhere — every fetch that would use it returns first. It is passed
            only because PlanView's signature takes it. */}
        <PlanView
          preview
          token=""
          model={payload.model}
          plan={payload.plan}
          items={payload.items}
        />
      </div>
    </div>
  )
}
