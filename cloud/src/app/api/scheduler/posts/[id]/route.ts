import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { AutoposterError, deletePost, postAction, resolveWorkspace } from '@/lib/autoposter'
import { deleteSchedulerPost, markSchedulerWorkspaceStale, setSchedulerPostStatus } from '@/lib/scheduler-store'

type Params = { params: Promise<{ id: string }> }

/** Delete one post from the calendar (Geno, 2026-10-14). */
export async function DELETE(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const workspace = new URL(request.url).searchParams.get('workspace')
  try {
    const resolved = resolveWorkspace(workspace)
    await deletePost(resolved, id)
    try {
      await deleteSchedulerPost(resolved, id)
    } catch {
      await markSchedulerWorkspaceStale(resolved).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AutoposterError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Autoposter did not answer — try again.' }, { status: 502 })
  }
}

/** Approve a post awaiting review, or drop a draft into the queue. */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action === 'approve' || body.action === 'queue' ? body.action : null
  if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  const workspace = typeof body.workspace === 'string' ? body.workspace : null

  try {
    const resolved = resolveWorkspace(workspace)
    await postAction(resolved, id, action)
    try {
      await setSchedulerPostStatus(resolved, id, action === 'queue' ? 'queued' : 'approved')
    } catch {
      await markSchedulerWorkspaceStale(resolved).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AutoposterError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Autoposter did not answer — try again.' }, { status: 502 })
  }
}
