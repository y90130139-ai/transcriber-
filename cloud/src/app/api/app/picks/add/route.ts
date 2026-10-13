import { NextResponse } from 'next/server'
import { addStarToWeek } from '@/lib/discover'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * A starred card onto her own working week (Geno, 2026-10-12) — the same
 * door the console's Recreate uses, declines and the solo rule re-checked
 * inside. Saying why beats a silent no.
 */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
  if (!jobId) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const result = await addStarToWeek(session.modelId, jobId)
  if (!result.added) return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 })
  return NextResponse.json({ ok: true, week_of: result.week_of })
}
