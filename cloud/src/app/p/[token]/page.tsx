import { notFound } from 'next/navigation'
import { after } from 'next/server'
import PlanView from '@/components/plan/PlanView'
import { logEvent } from '@/lib/events'
import { loadPlan, markOpened } from '@/lib/plans'

// The token is the auth: this route sits outside the password gate, holds no
// session, and is never cached or statically rendered.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Unknown, malformed and revoked tokens all land here. Never a 403 — that
  // would confirm there is something behind the URL.
  const plan = await loadPlan(token)
  if (!plan) notFound()

  // The first open, stamped here rather than from a client effect — the whole
  // value of the signal is that it survives a phone with JS off, and a render
  // that reached this line is an open whatever the browser does next.
  if (!plan.plan.opened_at) await markOpened(plan.plan.id)
  // Every return, not only the first. Throttled inside, and scheduled after
  // the page is sent so it never costs her render a round trip.
  after(() => logEvent({ modelId: plan.model.id, planId: plan.plan.id, kind: 'visit' }))

  return <PlanView token={token} model={plan.model} plan={plan.plan} items={plan.items} />
}
