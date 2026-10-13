import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { isInboxKey } from '@/lib/inbox'
import { presignGet, r2Config } from '@/lib/r2'

type Params = { params: Promise<{ key: string[] }> }

/** A file in a thread, for the console (2026-10-12): a redirect to a
 *  presigned R2 read. The key shape is checked before anything is signed.
 *  `?download=name` signs it as an attachment instead, so the browser saves
 *  the file — the viewer's download link relies on that (2026-10-13). */
export async function GET(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return new Response('unauthorized', { status: 401 })

  const { key } = await params
  const joined = (key ?? []).join('/')
  if (!isInboxKey(joined)) return new Response('not found', { status: 404 })

  const config = r2Config()
  if (!config) return new Response('not found', { status: 404 })

  const download = new URL(request.url).searchParams.get('download')
  if (download !== null) {
    const filename = (download || 'file').replace(/["\\\r\n]/g, '').slice(0, 120) || 'file'
    return NextResponse.redirect(
      presignGet(config, joined, {
        ttlSec: 60 * 60,
        extraQuery: { 'response-content-disposition': `attachment; filename="${filename}"` },
      }),
    )
  }

  return NextResponse.redirect(presignGet(config, joined, { ttlSec: 6 * 60 * 60 }))
}
