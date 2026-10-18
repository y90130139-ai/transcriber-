import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { syncScheduler } from '@/lib/scheduler-sync'

export const maxDuration = 300

/** Ensure a first or stale snapshot exists before the calendar is read. */
export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const result = await syncScheduler()
    return NextResponse.json(result, { status: result.errors.length > 0 && result.synced === 0 ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: 'Scheduler sync failed — try again.' }, { status: 503 })
  }
}
