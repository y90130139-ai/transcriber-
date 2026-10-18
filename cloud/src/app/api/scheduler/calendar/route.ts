import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { autoposterConfigured, workspaces } from '@/lib/autoposter'
import { readSchedulerCalendar } from '@/lib/scheduler-store'

export const maxDuration = 300

/** Read the locally persisted scheduler snapshot; Autoposter is hit by sync only. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  if (!autoposterConfigured()) {
    return NextResponse.json({
      configured: false,
      workspaces: [],
      accounts: [],
      posts: [],
      loaded: 0,
      failed: [],
      total: 0,
      errors: [],
    })
  }

  try {
    const query = new URL(request.url).searchParams
    const data = await readSchedulerCalendar({
      status: query.get('status') ?? undefined,
      account: query.get('account') ?? undefined,
      from: query.get('from') ?? undefined,
      to: query.get('to') ?? undefined,
    })
    return NextResponse.json({
      configured: true,
      workspaces: workspaces(),
      accounts: data.accounts,
      posts: data.posts,
      loaded: data.loaded,
      failed: data.failed,
      total: data.total,
      errors: data.errors,
    })
  } catch {
    return NextResponse.json({ error: 'Could not read scheduler data from the database — try again.' }, { status: 503 })
  }
}
