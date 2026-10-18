import { NextResponse } from 'next/server'
import { logAppEvent } from '@/lib/app-activity'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * First-run milestones, reported by her phone (2026-10-14).
 *
 * The app has two screens every new model passes through — the welcome tour
 * and the onboarding checklist. Neither used to leave the phone, so the
 * console could not tell a woman who walked the whole way in from one who
 * stopped at the first screen. She reports here; each kind lands once.
 */
const KINDS = ['tour', 'onboarding'] as const
type Kind = (typeof KINDS)[number]

export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const kind = typeof body?.kind === 'string' && (KINDS as readonly string[]).includes(body.kind)
    ? (body.kind as Kind)
    : null
  if (!kind) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const saved = await logAppEvent(session.modelId, kind, null, { once: true })
  if (!saved) return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503 })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
