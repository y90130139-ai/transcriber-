import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { AutoposterError, autoposterConfigured, resolveWorkspace, uploadMedia, workspaces } from '@/lib/autoposter'
import { markSchedulerWorkspaceStale, readSchedulerMedia, upsertSchedulerMedia } from '@/lib/scheduler-store'
import { kickSchedulerSync } from '@/lib/scheduler-sync'

/**
 * The Scheduler's media library (Geno, 2026-10-14). The composer uploads one
 * file per request through the API's direct multipart door — the same bytes
 * the dashboard would take. Large-video chunked uploads stay a later door.
 */
const MAX_BYTES = 100 * 1024 * 1024

export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  if (!autoposterConfigured()) {
    return NextResponse.json({ configured: false, workspace: null, workspaces: [], media: [] })
  }

  const workspace = new URL(request.url).searchParams.get('workspace')
  try {
    const resolved = resolveWorkspace(workspace)
    kickSchedulerSync({ prioritize: resolved })
    return NextResponse.json({
      configured: true,
      workspace: resolved,
      workspaces: workspaces(),
      media: await readSchedulerMedia(resolved),
    })
  } catch (error) {
    if (error instanceof AutoposterError) {
      return NextResponse.json(
        { configured: true, workspace: null, workspaces: workspaces(), media: [], error: error.message },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: 'Could not read scheduler media from the database — try again.' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file arrived — try again.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is too large — keep it under 100 MB.' }, { status: 413 })
  }
  const field = form?.get('workspace')
  const workspace = typeof field === 'string' ? field : null

  try {
    const resolved = resolveWorkspace(workspace)
    const media = await uploadMedia(resolved, file)
    try {
      await upsertSchedulerMedia(resolved, media)
    } catch {
      await markSchedulerWorkspaceStale(resolved).catch(() => {})
    }
    return NextResponse.json({ ok: true, media })
  } catch (error) {
    if (error instanceof AutoposterError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'The upload did not go through — try again.' }, { status: 502 })
  }
}
