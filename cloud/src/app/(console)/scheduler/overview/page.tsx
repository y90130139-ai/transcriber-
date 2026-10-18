import { requirePage } from '@/lib/access'
import { autoposterConfigured, workspaces } from '@/lib/autoposter'
import { addDaysIso } from '@/components/scheduler/schedule-dates'
import OverviewTab from '@/components/scheduler/OverviewTab'
import { readSchedulerData } from '@/lib/scheduler-store'
import { kickSchedulerSync } from '@/lib/scheduler-sync'

/**
 * The Scheduler's overview — the workspace at a glance, laid out the way
 * the marketing Overview is: headline stats on top, the volume graph beside
 * what's up next, then the platform split and what needs a yes.
 *
 * Server-rendered: the last sixty days behind and the next thirty ahead
 * arrive with the first paint. Autoposter exposes no analytics endpoint, so
 * every number is queue truth — scheduled, published, drafted, failed.
 */
export default async function SchedulerOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>
}) {
  await requirePage('scheduler_overview')
  const ids = workspaces()
  const { workspace: requested } = await searchParams
  const workspace = (requested && ids.includes(requested) ? requested : ids[0]) ?? null

  if (!workspace) {
    return <OverviewTab configured={false} workspace={null} workspaces={[]} initial={{ posts: [], accounts: [], mediaCount: 0 }} />
  }

  try {
    const now = new Date().toISOString().slice(0, 10)
    kickSchedulerSync({ prioritize: workspace })
    const data = await readSchedulerData(ids)
    const all = ids.map((id) => ({
      id,
      accounts: data.accounts
        .filter((account) => account.workspaceId === id)
        .map(({ workspaceId: _workspaceId, ...account }) => account),
    }))
    const selected = all.find((group) => group.id === workspace)
    const from = addDaysIso(now, -59)
    const to = addDaysIso(now, 30)
    const posts = data.posts.filter((post) => (
      post.workspaceId === workspace && post.date && post.date >= from && post.date <= to
    ))
    return (
      <OverviewTab
        configured
        workspace={workspace}
        workspaces={all.map(({ id, accounts }) => ({ id, accounts: accounts.length }))}
        initial={{
          posts,
          accounts: selected?.accounts ?? [],
          mediaCount: data.media.filter((item) => item.workspaceId === workspace).length,
        }}
      />
    )
  } catch {
    return (
      <OverviewTab
        configured
        workspace={workspace}
        workspaces={ids.map((id) => ({ id, accounts: 0 }))}
        initial={{ posts: [], accounts: [], mediaCount: 0 }}
      />
    )
  }
}
