import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { isSignedIn } from '@/lib/auth'

/** What a filled-in intake form actually arrives as. The first four can be
 *  read; the rest are stored whole and their text is pasted in, which is the
 *  honest trade against carrying a PDF parser into a serverless function for
 *  a document that gets read once. */
const ALLOWED = [
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'application/pdf', 'application/rtf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/** A form is a document, not a video. Anything near this is the wrong file. */
const MAX_BYTES = 8 * 1024 * 1024

/**
 * Her intake form, into the Blob store the phone uploads already use.
 *
 * Same store, same token, same browser-direct upload as `/api/uploads` — and
 * like the photo route, nothing here queues a transcription job. The parse
 * happens on `/api/models/[id]/intake`, once the URL is known.
 *
 * The file is kept rather than only its text: what she submitted is the record
 * of what she agreed to, and a mapping can be re-run against it later.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        if (!(await isSignedIn())) throw new Error('unauthorized')
        return { allowedContentTypes: ALLOWED, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true }
      },
      onUploadCompleted: async () => {
        // Nothing to record: the URL is posted to the intake route by the sheet.
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload failed'
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 400 })
  }
}
