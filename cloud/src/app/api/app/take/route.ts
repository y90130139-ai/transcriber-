import { NextResponse } from 'next/server'
import { modelSessionFrom } from '@/lib/model-auth'
import { itemForModel, modelById } from '@/lib/plans'
import { presign, r2Config } from '@/lib/r2'

/** Every refusal looks the same from outside: a 404 confirms nothing. */
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

/**
 * The upload target for one take (Geno, 2026-10-12).
 *
 * She filmed on her phone; the bytes go straight from the phone to Cloudflare
 * R2 — a presigned PUT, one hour of life — because routing a 40 MB take
 * through a serverless function is exactly the cap that kills video uploads.
 * The object lands at a stable key per card, so a re-record replaces the old
 * take instead of littering the bucket.
 *
 * The app calls this, uploads, then calls `/api/app/take/done` to record it.
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

  const config = r2Config()
  if (!config) {
    return NextResponse.json({ error: 'Uploads are not set up yet — tell the team.' }, { status: 503 })
  }

  // A filmed clip or a photo (Geno, 2026-10-12) — same slot, different byte.
  const kind = body?.kind === 'photo' ? 'photo' : 'video'
  const key = `takes/${model.id}/${owned.id}.${kind === 'photo' ? 'jpg' : 'mp4'}`
  return NextResponse.json({
    ok: true,
    kind,
    key,
    upload_url: presign(config, key, { method: 'PUT', ttlSec: 60 * 60 }),
  })
}
