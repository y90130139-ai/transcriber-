import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { isSignedIn } from '@/lib/auth'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/avif']
const MAX_BYTES = 12 * 1024 * 1024

/** A model's profile photo, into the Blob store the phone uploads already use.
 *
 * Same store, same token, same browser-direct upload as `/api/uploads` — the
 * only difference is that nothing here queues a transcription job, because a
 * headshot is not something the Mac should try to transcribe.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        if (!(await isSignedIn())) throw new Error('unauthorized')
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        }
      },
      onUploadCompleted: async () => {
        // Nothing to record: the URL goes on the model row when the sheet saves.
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload failed'
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 400 })
  }
}
