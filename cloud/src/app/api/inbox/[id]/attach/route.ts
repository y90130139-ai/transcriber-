import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { readThread } from '@/lib/inbox'
import { newId } from '@/lib/models'
import { putObject, r2Config } from '@/lib/r2'

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
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
}

/** A clip or a still, not a movie — the console's one guard. */
const MAX_BYTES = 100 * 1024 * 1024

/**
 * The upload for a file in a thread (2026-10-12; server-side since
 * 2026-10-14).
 *
 * The console used to PUT straight to a presigned R2 URL, and the bucket's
 * missing CORS policy refused the browser's preflight — "The upload did not
 * go through" for every file. The bytes come through this route and are
 * put to R2 here instead; no browser origin rules involved. (The phone
 * still uploads directly to presigned URLs on the app's own routes —
 * native fetch has no CORS.)
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params

  const read = await readThread(id, 'team', null)
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const config = r2Config()
  if (!config) return NextResponse.json({ error: 'Uploads are not set up yet.' }, { status: 503 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file arrived — try again.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is too large — keep it under 100 MB.' }, { status: 413 })
  }

  const contentType = (file.type || '').toLowerCase()
  const ext = EXT[contentType]
  if (!ext) return NextResponse.json({ error: 'That file type is not supported.' }, { status: 400 })

  const key = `inbox/${id}/${newId()}.${ext}`
  try {
    await putObject(config, key, new Uint8Array(await file.arrayBuffer()), contentType)
  } catch {
    return NextResponse.json({ error: 'The upload did not go through — try again.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, key, content_type: contentType })
}
