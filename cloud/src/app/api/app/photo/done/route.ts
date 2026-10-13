import { NextResponse } from 'next/server'
import { appOrigin } from '@/lib/app-email'
import { sql } from '@/lib/db'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * The photo landed in R2. Point her model row at it (Geno, 2026-10-12).
 *
 * `photo_url` is the same column the console roster, the plan editor and the
 * web portal already show — the version stamp is what tells a browser holding
 * the old picture to fetch the new one. This is the sync: she sets it in the
 * app, the whole transcriber sees it, and the other way round.
 */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const photoUrl = `${appOrigin(request)}/api/photo/${session.modelId}?v=${Date.now()}`
  const rows = await sql.query(
    `update transcriber.models set photo_url = $2, updated_at = now() where id = $1 returning id`,
    [session.modelId, photoUrl],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'no_model' }, { status: 404 })
  return NextResponse.json({ ok: true, photo_url: photoUrl })
}
