import { requirePage } from '@/lib/access'
import { autoposterConfigured, workspaces } from '@/lib/autoposter'
import { monthStart } from '@/components/scheduler/schedule-dates'
import SchedulerTab from '@/components/scheduler/SchedulerTab'

/**
 * The Scheduler's calendar — every workspace on one month grid.
 *
 * The page paints immediately; the client asks the server to refresh a due
 * Postgres snapshot, then reads that saved calendar. The Railway worker keeps
 * the same snapshot fresh every four hours.
 */
export default async function SchedulerPage() {
  await requirePage('scheduler_calendar')
  const ids = workspaces()
  const today = new Date().toISOString().slice(0, 10)
  const anchor = monthStart(today)
  const configured = autoposterConfigured() && ids.length > 0

  return (
    <SchedulerTab
      configured={configured}
      workspaces={ids.map((id) => ({ id, accounts: 0 }))}
      initial={{ posts: [], accounts: [] }}
      anchor={anchor}
      today={today}
      coverage={{ loaded: 0, failed: [], total: ids.length }}
    />
  )
}
