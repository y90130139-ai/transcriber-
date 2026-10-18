import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import {
  AutoposterError,
  autoposterConfigured,
  createPost,
  resolveWorkspace,
  workspaces,
  type CreatePostInput,
} from '@/lib/autoposter'
import { readSchedulerPosts, markSchedulerWorkspaceStale, upsertSchedulerPost } from '@/lib/scheduler-store'
import { kickSchedulerSync } from '@/lib/scheduler-sync'

export const maxDuration = 300

/** Read posts from the saved snapshot; new posts still write through to Autoposter. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  if (!autoposterConfigured()) {
    return NextResponse.json({
      configured: false,
      workspace: null,
      workspaces: [],
      posts: [],
      loaded: 0,
      failed: [],
      total: 0,
      errors: [],
    })
  }

  const query = new URL(request.url).searchParams
  const requested = query.get('workspace')
  try {
    const resolved = requested && requested !== 'all' ? resolveWorkspace(requested) : 'all'
    kickSchedulerSync({ prioritize: resolved === 'all' ? undefined : resolved })
    const result = await readSchedulerPosts(resolved, {
      status: query.get('status') ?? undefined,
      account: query.get('account') ?? undefined,
      from: query.get('from') ?? undefined,
      to: query.get('to') ?? undefined,
    })
    return NextResponse.json({
      configured: true,
      workspace: resolved,
      workspaces: workspaces(),
      posts: result.posts,
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
          posts: [],
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

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as Partial<CreatePostInput> & { workspace?: unknown }
  const accounts = Array.isArray(body.accounts) ? body.accounts.filter((id): id is number => Number.isFinite(id)) : []
  if (accounts.length === 0) return NextResponse.json({ error: 'Pick at least one account.' }, { status: 400 })

  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 5000) : ''
  const media = Array.isArray(body.media) ? body.media.filter((id): id is number => Number.isFinite(id)) : []
  if (!text && media.length === 0) return NextResponse.json({ error: 'Write a caption or attach media.' }, { status: 400 })

  const when = body.when ?? { mode: 'queue' as const }
  if (when.mode === 'schedule' && (!when.date || !when.time)) {
    return NextResponse.json({ error: 'Pick a date and a time.' }, { status: 400 })
  }

  try {
    const workspace = typeof body.workspace === 'string' ? body.workspace : null
    const post = await createPost(workspace, {
      accounts,
      body: text,
      media,
      instagramType: body.instagramType,
      youtubeTitle: typeof body.youtubeTitle === 'string' ? body.youtubeTitle.trim().slice(0, 100) : undefined,
      when,
    })
    const resolved = resolveWorkspace(workspace)
    if (post) {
      try {
        await upsertSchedulerPost(resolved, post)
      } catch {
        await markSchedulerWorkspaceStale(resolved).catch(() => {})
      }
    } else {
      await markSchedulerWorkspaceStale(resolved).catch(() => {})
    }
    return NextResponse.json({ ok: true, post })
  } catch (error) {
    if (error instanceof AutoposterError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Autoposter did not answer — try again.' }, { status: 502 })
  }
}
