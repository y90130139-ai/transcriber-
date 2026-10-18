import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import {
  AutoposterError,
  autoposterConfigured,
  resolveWorkspace,
  workspaces,
} from '@/lib/autoposter'
import { readSchedulerData } from '@/lib/scheduler-store'
import { kickSchedulerSync } from '@/lib/scheduler-sync'

export const maxDuration = 300

/**
 * The Scheduler's connected accounts (Geno, 2026-10-15) — read-only.
 * `?workspace=all` (or omitting workspace) returns every account across
 * every workspace the token reaches, stamped with workspaceId.
 */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  if (!autoposterConfigured()) {
    return NextResponse.json({
      configured: false,
      workspace: null,
      workspaces: [],
      accounts: [],
      loaded: 0,
      failed: [],
      total: 0,
      errors: [],
    })
  }

  const workspace = new URL(request.url).searchParams.get('workspace')
  try {
    const resolved = workspace && workspace !== 'all' ? resolveWorkspace(workspace) : 'all'
    kickSchedulerSync({ prioritize: resolved === 'all' ? undefined : resolved })
    const ids = resolved === 'all' ? workspaces() : [resolved]
    const result = await readSchedulerData(ids)
    return NextResponse.json({
      configured: true,
      workspace: resolved,
      workspaces: workspaces(),
      accounts: result.accounts,
      loaded: result.loaded,
      failed: result.failed,
      total: result.total,
      errors: result.errors,
    })
  } catch (error) {
    if (error instanceof AutoposterError) {
      return NextResponse.json(
        {
          configured: true,
          workspace: null,
          workspaces: workspaces(),
          accounts: [],
          loaded: 0,
          failed: workspaces(),
          total: workspaces().length,
          errors: [{ workspaceId: '', message: error.message, status: error.status }],
          error: error.message,
        },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: 'Could not read scheduler data from the database — try again.' }, { status: 503 })
  }
}
