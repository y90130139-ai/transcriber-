'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

const PREVIEW_DEBOUNCE_MS = 250

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
  const [attempt, setAttempt] = useState(0)
  /** The week it is showing. A switch of week blanks the phone rather than
   *  showing last week's page under this week's head. */
  const [shownFor, setShownFor] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    const response = await fetch(`/api/plans/${planId}/preview`, { signal: controller.signal }).catch(() => null)
    if (controller.signal.aborted) return
    if (!response?.ok) {
      setFailed(true)
      return
    }
    const body = await response.json().catch(() => null)
    if (controller.signal.aborted) return
    setFailed(!body)
    if (body) {
      setPayload(body)
      setShownFor(planId)
    }
  }, [planId])

  // Saves arrive in bursts — a blur, then the list refreshing, then the week
  // rail — and each used to fire its own refetch, landing in whatever order
  // the network chose. One fetch per burst, and only the newest is painted.
  useEffect(() => {
    const timer = setTimeout(() => { void load() }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [load, revision, attempt])
  useEffect(() => () => inFlight.current?.abort(), [])

  const ready = payload && shownFor === planId

  return (
    <div className="planphone" data-state={failed && !ready ? 'failed' : ready ? 'ready' : 'loading'}>
      <span className="planphone-notch" aria-hidden="true" />
      <div className="planphone-screen" aria-busy={!ready || undefined}>
        {ready ? (
          /* The token is hers and real, but nothing in preview mode sends it
             anywhere — every fetch that would use it returns first. It is
             passed only because PlanView's signature takes it. */
          <PlanView
            preview
            token=""
            model={payload.model}
            plan={payload.plan}
            items={payload.items}
          />
        ) : failed ? (
          <div className="planphone-state" role="alert">
            <p className="planphone-state-title">The preview could not load</p>
            <p>Their link itself is unaffected.</p>
            <button type="button" className="chip" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : (
          <div className="planphone-skel" aria-label="Loading their page">
            <span data-h="head" />
            <span data-h="line" />
            <span data-h="card" />
            <span data-h="card" />
          </div>
        )}
      </div>
    </div>
  )
}
