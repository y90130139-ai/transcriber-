import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

/** The poster frame, as an image rather than a data URL inside every payload.
 *
 * Thumbnails are immutable once a job finishes, so the browser can hold them
 * forever and the polling grid stops re-sending a megabyte of base64. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return new Response('unauthorized', { status: 401 })
  const { id } = await params

  const [row] = await sql.query(
    `select thumbnail from transcriber.transcripts where job_id = $1`,
    [id],
  )
  const dataUrl = row?.thumbnail as string | undefined
  const match = dataUrl?.match(/^data:(image\/[a-z+]+);base64,(.+)$/s)
  if (!match) return new Response('not found', { status: 404 })

  return new Response(Buffer.from(match[2], 'base64') as unknown as BodyInit, {
    headers: {
      'Content-Type': match[1],
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
