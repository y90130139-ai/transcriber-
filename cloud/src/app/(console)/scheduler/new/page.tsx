import { requirePage } from '@/lib/access'
import { autoposterConfigured, workspaces, type ApAccount } from '@/lib/autoposter'
import ComposerTab from '@/components/scheduler/ComposerTab'
import { readSchedulerAccountsForWorkspace } from '@/lib/scheduler-store'
import { kickSchedulerSync } from '@/lib/scheduler-sync'

/**
 * The composer — one caption, its media, its accounts, and when it goes out.
 * The accounts for the selected workspace arrive server-side; a `?date=`
 * from a calendar day (and a carried `?workspace=`) prefill the schedule.
 */
export default async function SchedulerNewPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; workspace?: string }>
}) {
  await requirePage('scheduler_new')
  const ids = workspaces()
  const { date, workspace: requested } = await searchParams
  const workspace = (requested && ids.includes(requested) ? requested : ids[0]) ?? null
  const preset = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : null

  if (!workspace) {
    return <ComposerTab configured={false} workspaces={[]} initialWorkspace={null} accounts={[]} preset={preset} />
  }

  let accounts: ApAccount[] = []
  try {
    kickSchedulerSync({ prioritize: workspace })
    accounts = await readSchedulerAccountsForWorkspace(workspace)
  } catch {
    accounts = []
  }
  return (
    <ComposerTab
      configured
      workspaces={ids}
      initialWorkspace={workspace}
      accounts={accounts}
      preset={preset}
    />
  )
}
