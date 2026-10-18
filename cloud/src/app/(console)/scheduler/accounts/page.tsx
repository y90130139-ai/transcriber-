import { requirePage } from '@/lib/access'
import { autoposterConfigured, workspaces } from '@/lib/autoposter'
import AccountsTab from '@/components/scheduler/AccountsTab'
import { readSchedulerData } from '@/lib/scheduler-store'
import { kickSchedulerSync } from '@/lib/scheduler-sync'

/**
 * Every social account the token's workspaces can publish to — flat table
 * with profile photos and live profile links.
 */
export default async function SchedulerAccountsPage() {
  await requirePage('scheduler_accounts')
  const ids = workspaces()

  if (!autoposterConfigured() || ids.length === 0) {
    return <AccountsTab configured={false} groups={[]} />
  }

  kickSchedulerSync()
  const result = await readSchedulerData(ids)
  const groups = ids.map((id) => ({
    id,
    accounts: result.accounts.filter((account) => account.workspaceId === id),
  }))
  return (
    <AccountsTab
      configured
      groups={groups}
      coverage={{
        loaded: result.loaded,
        total: result.total,
        failed: result.failed,
        message: result.errors[0]?.message,
      }}
    />
  )
}
