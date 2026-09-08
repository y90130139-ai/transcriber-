import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { nanoid } from 'nanoid'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'

const ALLOWED = [
  'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/aac',
]

/** Phone uploads go straight to Blob storage; only the token is issued here.
 *
 * Routing the bytes through a serverless function would cap uploads at a few
 * megabytes, which no video clears. The browser uploads directly and this route
 * records the finished blob as a job for the Mac to pick up.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await isSignedIn())) throw new Error('unauthorized')
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ name: pathname.split('/').pop() ?? 'clip' }),
        }
      },
      // Uploads get a speech pass like everything else; what it hears sets the
      // label. No flag has to survive the trip through Blob to make that work.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { name } = JSON.parse(tokenPayload || '{}')
        await sql.query(
          `insert into transcriber.jobs (id, kind, source, source_key, label)
           values ($1, 'file', $2, $2, $3)
           on conflict (source_key) do nothing`,
          [nanoid(12), blob.url, name || blob.pathname],
        )
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload failed'
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 400 })
  }
}
