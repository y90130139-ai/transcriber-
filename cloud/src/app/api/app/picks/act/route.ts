import { NextResponse, after } from 'next/server'
import { logAppEvent } from '@/lib/app-activity'
import { actOnCard } from '@/lib/discover'
import { modelSessionFrom } from '@/lib/model-auth'

/** Her answer on one card — star it or swipe it away. Only cards that were
 *  dealt to her can be acted on; anything else changes nothing (2026-10-12). */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
  const action = body?.action === 'star' ? 'star' : body?.action === 'pass' ? 'pass' : null
  if (!jobId || !action) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const changed = await actOnCard(session.modelId, jobId, action)
  if (!changed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Her swipe is a signal with no timestamp of its own — her page's timeline
  // keeps it here (2026-10-14).
  after(async () => {
    await logAppEvent(session.modelId, 'discover', action)
  })
  return NextResponse.json({ ok: true, action })
}
