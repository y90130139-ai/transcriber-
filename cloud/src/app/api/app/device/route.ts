import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { modelSessionFrom } from '@/lib/model-auth'
import { newId } from '@/lib/models'

/**
 * Her phone, registered for push (Geno, 2026-10-12).
 *
 * One row per device; the token is the identity, so signing in again on the
 * same phone just freshens the row. Sign-out removes it — a phone that is no
 * longer signed in must stop being phoned.
 */

const isPushToken = (value: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value)

export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!isPushToken(token)) {
    return NextResponse.json({ error: 'That is not an Expo push token.' }, { status: 400 })
  }
  const platform = body?.platform === 'ios' || body?.platform === 'android' ? body.platform : null

  await sql.query(
    `insert into transcriber.model_devices (id, model_id, token, platform)
     values ($1, $2, $3, $4)
     on conflict (token) do update
       set model_id = $2,
           platform = coalesce($4, transcriber.model_devices.platform),
           last_seen_at = now()`,
    [newId(), session.modelId, token, platform],
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!isPushToken(token)) return NextResponse.json({ ok: true })

  await sql.query(
    `delete from transcriber.model_devices where token = $1 and model_id = $2`,
    [token, session.modelId],
  )
  return NextResponse.json({ ok: true })
}
