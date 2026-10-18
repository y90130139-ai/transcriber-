import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { syncScheduler } from '@/lib/scheduler-sync'

export const maxDuration = 300

/** Railway's durable worker calls this every four hours with WORKER_SECRET. */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await syncScheduler())
  } catch {
    return NextResponse.json({ error: 'Scheduler sync failed before it could finish.' }, { status: 503 })
  }
}
