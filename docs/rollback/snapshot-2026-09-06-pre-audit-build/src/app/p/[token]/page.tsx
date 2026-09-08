import { notFound } from 'next/navigation'
import PlanView from '@/components/plan/PlanView'
import { loadPlan } from '@/lib/plans'

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

  return <PlanView token={token} model={plan.model} plan={plan.plan} items={plan.items} />
}
