import { NextResponse } from 'next/server'
import { readThread } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'
import { newId } from '@/lib/models'
import { presign, r2Config } from '@/lib/r2'

type Params = { params: Promise<{ id: string }> }

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}

/** The upload target for a file she sends (2026-10-12) — photos and videos
 *  straight to R2, on threads she is actually in. */
export async function POST(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const read = await readThread(id, 'model', session.modelId)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const contentType = typeof body?.content_type === 'string' ? body.content_type.toLowerCase() : ''
  const ext = EXT[contentType]
  if (!ext) return NextResponse.json({ error: 'That file type is not supported.' }, { status: 400 })

  const config = r2Config()
  if (!config) return NextResponse.json({ error: 'Uploads are not set up yet.' }, { status: 503 })

  const key = `inbox/${id}/${newId()}.${ext}`
  return NextResponse.json({
    ok: true,
    key,
    content_type: contentType,
    upload_url: presign(config, key, { method: 'PUT', ttlSec: 60 * 60 }),
  })
}
