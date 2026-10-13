import { NextResponse, after } from 'next/server'
import { sql } from '@/lib/db'
import { logEvent } from '@/lib/events'
import { modelSessionFrom } from '@/lib/model-auth'
import { itemForModel, modelById } from '@/lib/plans'

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

/**
 * The take has landed in R2. Record it on the card — and the card is now
 * filmed, because she filmed it (Geno, 2026-10-12).
 *
 * The key is rebuilt from the card's own ids rather than trusted from the
 * request: the app cannot point a card at somebody else's object, and a
 * re-record that skipped this call still shows as unfilmed until it reports.
 */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const model = await modelById(session.modelId)
  if (!model) return notFound()

  const owned = await itemForModel(model, body.item_id)
  if (!owned) return notFound()

  const bytes = Number.isFinite(Number(body.bytes)) ? Math.max(0, Math.round(Number(body.bytes))) : null
  const duration = Number.isFinite(Number(body.duration_sec)) ? Math.max(0, Number(body.duration_sec)) : null
  const kind = body.kind === 'photo' ? 'photo' : 'video'

  await sql.query(
    `update transcriber.plan_items
        set take_key = $2, take_bytes = $3, take_duration_sec = $4, take_uploaded_at = now(),
            take_kind = $5,
            filmed_at = coalesce(filmed_at, now())
      where id = $1`,
    [owned.id, `takes/${owned.modelId}/${owned.id}.${kind === 'photo' ? 'jpg' : 'mp4'}`, bytes, duration, kind],
  )

  // Only a change is an act; a re-record of an already-filmed card is the
  // same state, deliberately.
  if (!owned.filmed) {
    after(() => logEvent({ modelId: owned.modelId, planId: owned.planId, itemId: owned.id, kind: 'film' }))
  }
  return NextResponse.json({ ok: true, filmed: true })
}
