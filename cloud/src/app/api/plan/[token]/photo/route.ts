import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { modelForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'

type Params = { params: Promise<{ token: string }> }

/** Resized in her browser before it gets here, so the cap is generous for a
 *  256px JPEG and still small enough that nothing else fits through it. */
const MAX_BYTES = 300_000
const SHAPE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

/** `{ data_url }` — her profile picture, from the setup sheet. Stored on
 *  `models.photo_url`, which is the same field the console reads: what she
 *  picks is what the team sees. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`photo:${token}`, 10)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }
  const model = await modelForToken(token)
  if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = await request.json().catch(() => null)
  const dataUrl = body?.data_url
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_BYTES || !SHAPE.test(dataUrl)) {
    return NextResponse.json({ error: 'a small image data URL is required' }, { status: 400 })
  }
  await sql.query(`update transcriber.models set photo_url = $2 where id = $1`, [model.id, dataUrl])
  return NextResponse.json({ ok: true })
}
