import 'server-only'

import {
  AutoposterError,
  autoposterConfigured,
  listAccounts,
  listMedia,
  listPosts,
  workspaces,
} from './autoposter'
import { q } from '@/lib/db'
import {
  claimSchedulerWorkspace,
  ensureSchedulerWorkspaceRows,
  markSchedulerSyncFailure,
  SCHEDULER_SYNC_HOURS,
  upsertSchedulerSnapshot,
} from './scheduler-store'

const WORKSPACES_PER_PASS = 6

export type SchedulerSyncResult = {
  ok: boolean
  synced: number
  skipped: number
  total: number
  pending: number
  remaining: number
  intervalHours: number
  errors: { workspaceId: string; message: string; status: number | null }[]
}

/**
 * Pull one complete last-good snapshot per due workspace. The persistence
 * layer claims each workspace before any API calls, so the Railway worker and
 * a signed-in user's first page load cannot start duplicate syncs.
 */
export async function syncScheduler({
  force = false,
  prioritize,
}: { force?: boolean; prioritize?: string } = {}): Promise<SchedulerSyncResult> {
  const ids = workspaces()
  if (ids.length === 0) {
    return {
      ok: true,
      synced: 0,
      skipped: 0,
      total: 0,
      pending: 0,
      remaining: 0,
      intervalHours: SCHEDULER_SYNC_HOURS,
      errors: [],
    }
  }
  if (!autoposterConfigured()) {
    return {
      ok: false,
      synced: 0,
      skipped: 0,
      total: ids.length,
      pending: ids.length,
      remaining: 0,
      intervalHours: SCHEDULER_SYNC_HOURS,
      errors: [{ workspaceId: '', message: 'The scheduler is not connected yet.', status: 503 }],
    }
  }

  await ensureSchedulerWorkspaceRows(ids)
  const due = await q<{ workspace_id: string }>(
    `select workspace_id
       from transcriber.autoposter_snapshots
      where workspace_id = any($1::text[])
        and ($5::boolean or synced_at is null or synced_at < now() - ($2::int * interval '1 hour'))
        and ($5::boolean or attempted_at is null or attempted_at < now() - interval '15 minutes')
      order by case when workspace_id = $4::text then 0 else 1 end,
               array_position($1::text[], workspace_id)
      limit $3`,
    [ids, SCHEDULER_SYNC_HOURS, WORKSPACES_PER_PASS, prioritize && ids.includes(prioritize) ? prioritize : null, force],
  )
  let synced = 0
  let skipped = Math.max(0, ids.length - due.length)
  const errors: SchedulerSyncResult['errors'] = []

  for (const { workspace_id: workspace } of due) {
    if (!(await claimSchedulerWorkspace(workspace, force))) {
      skipped += 1
      continue
    }

    try {
      // Store only after all three reads finish. A failed page never replaces a
      // usable calendar with a partial or empty workspace snapshot.
      const accounts = await listAccounts(workspace)
      const posts = await listPosts(workspace)
      const media = await listMedia(workspace)
      await upsertSchedulerSnapshot(workspace, { accounts, posts, media })
      synced += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = error instanceof AutoposterError ? error.status : null
      errors.push({ workspaceId: workspace, message, status })
      await markSchedulerSyncFailure(workspace, message, status).catch(() => {})
    }
  }

  const [remaining] = await q<{ pending: number; ready: number }>(
    `select count(*)::int as pending,
            count(*) filter (
              where attempted_at is null or attempted_at < now() - interval '15 minutes'
            )::int as ready
       from transcriber.autoposter_snapshots
      where workspace_id = any($1::text[])
        and (synced_at is null or synced_at < now() - ($2::int * interval '1 hour'))`,
    [ids, SCHEDULER_SYNC_HOURS],
  )

  return {
    ok: errors.length === 0,
    synced,
    skipped,
    total: ids.length,
    pending: Number(remaining?.pending ?? 0),
    remaining: Number(remaining?.ready ?? 0),
    intervalHours: SCHEDULER_SYNC_HOURS,
    errors,
  }
}

/**
 * Kick the due sweep off behind the response (Geno, 2026-10-16). Pages and
 * composer reads paint from the stored snapshot in milliseconds; the
 * Autoposter calls — rate-gated at ~1.1s each, so tens of seconds for a
 * pass — run behind them. The store claims every workspace before any API
 * call, so kicking on each read still runs as one sweep, never a stampede.
 */
export function kickSchedulerSync({ prioritize }: { prioritize?: string } = {}): void {
  void syncScheduler({ prioritize }).catch(() => {})
}
