import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * What she filled out in the app (2026-10-14).
 *
 * The onboarding forms — the signed agreement, the contact form, the intake
 * form — used to live only on her phone (lib/checklist.ts). She submits them
 * here so the console's account page can read them; the console itself never
 * writes this table. Latest submission wins on read; history is kept.
 */
const KINDS = ['agreement', 'contact', 'intake'] as const
type Kind = (typeof KINDS)[number]

/** Allows the full signed agreement snapshot plus its signature metadata,
 *  while keeping each client submission bounded. */
const MAX_BYTES = 150_000

export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const kind = typeof body?.kind === 'string' && (KINDS as readonly string[]).includes(body.kind)
    ? (body.kind as Kind)
    : null
  if (!kind) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null
  if (!data) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  let encoded = ''
  try {
    encoded = JSON.stringify(data)
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (encoded.length > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }

  await sql.query(
    `insert into transcriber.app_submissions (id, model_id, kind, data) values ($1, $2, $3, $4::jsonb)`,
    [crypto.randomUUID().slice(0, 22).replace(/-/g, ''), session.modelId, kind, encoded],
  )
  return NextResponse.json({ ok: true })
}
