import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { presignGet, r2Config } from '@/lib/r2'

type Params = { params: Promise<{ id: string }> }

/**
 * Her photo, wherever it is needed (Geno, 2026-10-12): the console roster,
 * the plan, the web portal, and the inbox's faces all ask this one door.
 *
 * Two doors lead in: the app uploads straight to R2 (photos/<id>.jpg), the
 * console uploads to the Blob store and stamps `photo_url` on the model row.
 * The row is asked first — if it points somewhere that is not us, go there;
 * otherwise hand out the presigned R2 read. Cached briefly so a list of
 * forty faces does not re-ask for every render (2026-10-13).
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const [row] = await sql.query(`select photo_url from transcriber.models where id = $1`, [id]).catch(() => [])
  const photoUrl = typeof row?.photo_url === 'string' && row.photo_url.length > 0 ? row.photo_url : null

  // A row pointing somewhere else (the Blob store) is the newest word.
  if (photoUrl && !photoUrl.includes(`/api/photo/${id}`)) {
    const response = NextResponse.redirect(photoUrl)
    response.headers.set('Cache-Control', 'private, max-age=300')
    return response
  }

  const config = r2Config()
  if (!config) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const response = NextResponse.redirect(presignGet(config, `photos/${id}.jpg`, { ttlSec: 6 * 60 * 60 }))
  response.headers.set('Cache-Control', 'private, max-age=300')
  return response
}
