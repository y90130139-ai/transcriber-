import { NextResponse } from 'next/server'
import { modelSessionFrom } from '@/lib/model-auth'
import { presign, r2Config } from '@/lib/r2'

/**
 * The upload target for her profile photo (Geno, 2026-10-12).
 *
 * Presigned PUT straight to R2, one stable key per model — a new photo
 * replaces the old one in place, and `/api/photo/<id>` hands every surface
 * (her app, the console roster, the web portal) the same picture.
 */
export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const config = r2Config()
  if (!config) {
    return NextResponse.json({ error: 'Uploads are not set up yet — tell the team.' }, { status: 503 })
  }

  const key = `photos/${session.modelId}.jpg`
  return NextResponse.json({
    ok: true,
    key,
    upload_url: presign(config, key, { method: 'PUT', ttlSec: 60 * 60 }),
  })
}
