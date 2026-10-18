import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { subredditDetail } from '@/lib/reddit/queries'
import { isAdultCategory } from '@/lib/reddit/registry'
import { deleteSubreddit, updateSubreddit, type SubredditPatch } from '@/lib/reddit/store'

/** One community, whole: history, topics, top posts and errors. */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { name } = await params
  try {
    const detail = await subredditDetail(name.toLowerCase())
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

const PATCHABLE = ['category', 'enabled', 'paused', 'priority', 'interval_minutes', 'status', 'adult']

/** Pause, resume, re-prioritise, re-categorise. */
export async function PATCH(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { name } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const patch: SubredditPatch = {}
    for (const key of PATCHABLE) {
      if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key]
    }
    if (patch.category !== undefined) {
      if (!isAdultCategory(patch.category)) {
        return NextResponse.json({ error: 'Choose an adult-creator category' }, { status: 400 })
      }
      patch.adult = true
    }
    if (patch.priority && !['high', 'medium', 'low'].includes(patch.priority)) delete patch.priority
    if (patch.interval_minutes !== undefined) {
      patch.interval_minutes = Math.min(1440, Math.max(15, Number(patch.interval_minutes) || 60))
    }
    await updateSubreddit(name, patch)
    const detail = await subredditDetail(name.toLowerCase())
    return NextResponse.json({ ok: true, subreddit: detail?.subreddit ?? null })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** Remove tracking. Posts stay for aggregate history until retention runs. */
export async function DELETE(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { name } = await params
  try {
    await deleteSubreddit(name)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
