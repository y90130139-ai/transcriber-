import 'server-only'

import { q } from '@/lib/db'
import {
  workspaces,
  type ApAccount,
  type ApAccountScoped,
  type ApMedia,
  type ApPost,
  type PostFilters,
  type WorkspaceFailure,
} from './autoposter'

export const SCHEDULER_SYNC_HOURS = 4

type SnapshotRow = {
  workspace_id: string
  accounts: unknown
  posts: unknown
  media: unknown
  synced_at: Date | string | null
  last_error: string | null
  last_status: number | null
}

export type SchedulerData = {
  accounts: ApAccountScoped[]
  posts: ApPost[]
  media: (ApMedia & { workspaceId: string })[]
  loaded: number
  failed: string[]
  total: number
  errors: WorkspaceFailure[]
}

function arrayFromJson<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed as T[] : []
    } catch {
      return []
    }
  }
  return []
}

/** Read only the configured workspaces; a missing row is an honest unsynced state. */
export async function readSchedulerData(ids = workspaces()): Promise<SchedulerData> {
  if (ids.length === 0) {
    return { accounts: [], posts: [], media: [], loaded: 0, failed: [], total: 0, errors: [] }
  }

  const rows = await q<SnapshotRow>(
    `select workspace_id, accounts, posts, media, synced_at, last_error, last_status
       from transcriber.autoposter_snapshots
      where workspace_id = any($1::text[])`,
    [ids],
  )
  const byWorkspace = new Map(rows.map((row) => [row.workspace_id, row]))
  const failures: WorkspaceFailure[] = []
  let loaded = 0
  const accounts: ApAccountScoped[] = []
  const posts: ApPost[] = []
  const media: SchedulerData['media'] = []

  for (const id of ids) {
    const row = byWorkspace.get(id)
    if (!row?.synced_at || row.last_error) {
      failures.push({
        workspaceId: id,
        message: row?.last_error ?? 'Waiting for the first scheduler sync.',
        status: row?.last_status ?? null,
      })
    } else {
      loaded += 1
    }
    accounts.push(...arrayFromJson<ApAccount>(row?.accounts).map((account) => ({ ...account, workspaceId: id })))
    posts.push(...arrayFromJson<ApPost>(row?.posts).map((post) => ({ ...post, workspaceId: id })))
    media.push(...arrayFromJson<ApMedia>(row?.media).map((item) => ({ ...item, workspaceId: id })))
  }

  return {
    accounts,
    posts,
    media,
    loaded,
    failed: failures.map((failure) => failure.workspaceId),
    total: ids.length,
    errors: failures,
  }
}

export async function readSchedulerCalendar(filters: PostFilters = {}): Promise<SchedulerData> {
  const data = await readSchedulerData()
  const accountId = filters.account ? Number(filters.account) : null
  data.posts = data.posts.filter((post) => {
    if (filters.status && post.status !== filters.status.toLowerCase()) return false
    if (accountId !== null && Number.isFinite(accountId) && !post.accountIds.includes(accountId)) return false
    if (filters.from && (!post.date || post.date < filters.from)) return false
    if (filters.to && (!post.date || post.date > filters.to)) return false
    return true
  })
  return data
}

export async function readSchedulerPosts(workspace?: string | null, filters: PostFilters = {}): Promise<SchedulerData> {
  const ids = workspace && workspace !== 'all' ? [workspace] : workspaces()
  const data = await readSchedulerData(ids)
  const accountId = filters.account ? Number(filters.account) : null
  data.posts = data.posts.filter((post) => {
    if (filters.status && post.status !== filters.status.toLowerCase()) return false
    if (accountId !== null && Number.isFinite(accountId) && !post.accountIds.includes(accountId)) return false
    if (filters.from && (!post.date || post.date < filters.from)) return false
    if (filters.to && (!post.date || post.date > filters.to)) return false
    return true
  })
  return data
}

export async function readSchedulerAccountsForWorkspace(workspace: string): Promise<ApAccount[]> {
  const data = await readSchedulerData([workspace])
  return data.accounts.map(({ workspaceId: _workspaceId, ...account }) => account)
}

export async function readSchedulerMedia(workspace: string): Promise<ApMedia[]> {
  const data = await readSchedulerData([workspace])
  return data.media.map(({ workspaceId: _workspaceId, ...item }) => item)
}

export async function upsertSchedulerSnapshot(
  workspace: string,
  snapshot: { accounts: ApAccount[]; posts: ApPost[]; media: ApMedia[] },
): Promise<void> {
  await q(
    `insert into transcriber.autoposter_snapshots
       (workspace_id, accounts, posts, media, synced_at, attempted_at, last_error, last_status, updated_at)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, now(), now(), null, null, now())
     on conflict (workspace_id) do update set
       accounts = excluded.accounts,
       posts = excluded.posts,
       media = excluded.media,
       synced_at = now(),
       attempted_at = now(),
       last_error = null,
       last_status = null,
       updated_at = now()`,
    [workspace, JSON.stringify(snapshot.accounts), JSON.stringify(snapshot.posts), JSON.stringify(snapshot.media)],
  )
}

export async function ensureSchedulerWorkspaceRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await q(
    `insert into transcriber.autoposter_snapshots (workspace_id)
     select unnest($1::text[])
     on conflict (workspace_id) do nothing`,
    [ids],
  )
}

export async function claimSchedulerWorkspace(workspace: string, force = false): Promise<boolean> {
  const claimed = await q<{ workspace_id: string }>(
    `update transcriber.autoposter_snapshots
        set attempted_at = now(), updated_at = now()
      where workspace_id = $1
        and ($2::boolean or synced_at is null or synced_at < now() - ($3::int * interval '1 hour'))
        and ($2::boolean or attempted_at is null or attempted_at < now() - interval '15 minutes')
      returning workspace_id`,
    [workspace, force, SCHEDULER_SYNC_HOURS],
  )
  return claimed.length > 0
}

export async function markSchedulerSyncFailure(workspace: string, message: string, status: number | null): Promise<void> {
  await q(
    `insert into transcriber.autoposter_snapshots
       (workspace_id, attempted_at, last_error, last_status, updated_at)
     values ($1, now(), $2, $3, now())
     on conflict (workspace_id) do update set
       attempted_at = now(),
       last_error = excluded.last_error,
       last_status = excluded.last_status,
       updated_at = now()`,
    [workspace, message.slice(0, 500), status],
  )
}

async function ensureSnapshotRow(workspace: string): Promise<void> {
  await q(
    `insert into transcriber.autoposter_snapshots (workspace_id)
     values ($1) on conflict (workspace_id) do nothing`,
    [workspace],
  )
}

export async function upsertSchedulerPost(workspace: string, post: ApPost): Promise<void> {
  await ensureSnapshotRow(workspace)
  await q(
    `update transcriber.autoposter_snapshots as s
        set posts = (
              select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(s.posts) with ordinality as x(value, ordinality)
               where x.value->>'id' <> $2
            ) || $3::jsonb,
            last_error = null,
            last_status = null,
            updated_at = now()
      where s.workspace_id = $1`,
    [workspace, post.id, JSON.stringify([post])],
  )
}

export async function deleteSchedulerPost(workspace: string, postId: string): Promise<void> {
  await q(
    `update transcriber.autoposter_snapshots as s
        set posts = coalesce((
              select jsonb_agg(x.value order by x.ordinality)
                from jsonb_array_elements(s.posts) with ordinality as x(value, ordinality)
               where x.value->>'id' <> $2
            ), '[]'::jsonb),
            last_error = null,
            last_status = null,
            updated_at = now()
      where s.workspace_id = $1`,
    [workspace, postId],
  )
}

export async function setSchedulerPostStatus(workspace: string, postId: string, status: string): Promise<void> {
  await q(
    `update transcriber.autoposter_snapshots as s
        set posts = coalesce((
              select jsonb_agg(
                       case when x.value->>'id' = $2
                         then jsonb_set(x.value, '{status}', to_jsonb($3::text), true)
                         else x.value
                       end order by x.ordinality
                     )
                from jsonb_array_elements(s.posts) with ordinality as x(value, ordinality)
            ), '[]'::jsonb),
            last_error = null,
            last_status = null,
            updated_at = now()
      where s.workspace_id = $1`,
    [workspace, postId, status],
  )
}

export async function upsertSchedulerMedia(workspace: string, item: ApMedia): Promise<void> {
  await ensureSnapshotRow(workspace)
  await q(
    `update transcriber.autoposter_snapshots as s
        set media = (
              select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(s.media) with ordinality as x(value, ordinality)
               where x.value->>'id' <> $2
            ) || $3::jsonb,
            updated_at = now()
      where s.workspace_id = $1`,
    [workspace, String(item.id), JSON.stringify([item])],
  )
}

export async function markSchedulerWorkspaceStale(workspace: string): Promise<void> {
  await q(
    `update transcriber.autoposter_snapshots
        set synced_at = now() - ($2::int * interval '1 hour'), updated_at = now()
      where workspace_id = $1`,
    [workspace, SCHEDULER_SYNC_HOURS],
  )
}
