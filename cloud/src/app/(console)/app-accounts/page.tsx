import { requirePage } from '@/lib/access'
import { loadAppAccounts, type AppAccountRow } from '@/lib/app-accounts'
import AppAccountsTab from '@/components/roster/AppAccountsTab'

/** Every account the app has, and where each one stands.
 *
 *  Server-rendered (Geno, 2026-10-13): the list reads here and arrives with
 *  the first paint, so the page is instant instead of opening on placeholders
 *  and filling in after a fetch. The read is session-gated here, not only in
 *  the layout: a server page's render still travels in the response payload
 *  behind the sign-in gate, so an unauthenticated request must never carry
 *  the rows (the watchlist page measured this on 2026-10-13).
 *
 *  The old Invites screen lives on this page now (Geno, 2026-10-14) — the
 *  Invite button and the Pending invites tab — so whether email is
 *  configured rides along for the popup's hint. */
export default async function AppAccountsPage() {
  await requirePage('app_accounts')
  let initial: AppAccountRow[] = []
  let initialEmailConfigured = true
  let unreachable = false
  try {
    const snapshot = await loadAppAccounts()
    initial = snapshot.accounts
    initialEmailConfigured = snapshot.emailConfigured
  } catch {
    unreachable = true
  }
  return (
    <AppAccountsTab
      initial={initial}
      initialUnreachable={unreachable}
      initialEmailConfigured={initialEmailConfigured}
    />
  )
}
