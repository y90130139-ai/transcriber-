import { requirePage } from '@/lib/access'
import { notFound } from 'next/navigation'
import { loadAppAccountDetail } from '@/lib/app-accounts'
import AppAccountPage from '@/components/roster/AppAccountPage'

/** One creator's app account — everything she has done in the app.
 *
 *  Server-rendered like the list it opens from (Geno, 2026-10-14): the
 *  account, her devices, her questionnaire and the whole activity timeline
 *  arrive with the first paint. The read is session-gated here, not only in
 *  the layout — a server page's render travels in the response payload
 *  behind the sign-in gate, so an unauthenticated request must never carry
 *  her history.
 *
 *  `[id]` is the model id in the usual case: every table the timeline reads
 *  is model-keyed, and the account is found through it. An account id is
 *  taken too — an account that is not linked to a model yet opens on its own
 *  id, and that page's Settings tab is where it gets linked (2026-10-14).
 *  An unknown id is a 404, never a 403 — nothing here confirms what exists. */
export default async function AppAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage('app_accounts')
  const { id } = await params

  let detail = null
  let unreachable = false
  try {
    detail = await loadAppAccountDetail(id)
  } catch {
    unreachable = true
  }
  if (!detail && !unreachable) notFound()
  if (!detail) {
    return <AppAccountPage detail={null} unreachable />
  }
  return <AppAccountPage detail={detail} />
}
