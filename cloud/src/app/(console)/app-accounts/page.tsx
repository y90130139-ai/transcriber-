import { isSignedIn } from '@/lib/auth'
import { loadAppAccounts, type AppAccountRow } from '@/lib/app-accounts'
import AppAccountsTab from '@/components/roster/AppAccountsTab'

/** Every account the app has, and where each one stands.
 *
 *  Server-rendered (Geno, 2026-10-13): the list reads here and arrives with
 *  the first paint, so the page is instant instead of opening on placeholders
 *  and filling in after a fetch. The read is session-gated here, not only in
 *  the layout: a server page's render still travels in the response payload
 *  behind the sign-in gate, so an unauthenticated request must never carry
 *  the rows (the watchlist page measured this on 2026-10-13). */
export default async function AppAccountsPage() {
  let initial: AppAccountRow[] = []
  let unreachable = false
  if (await isSignedIn()) {
    try {
      initial = (await loadAppAccounts()).accounts
    } catch {
      unreachable = true
    }
  }
  return <AppAccountsTab initial={initial} initialUnreachable={unreachable} />
}
