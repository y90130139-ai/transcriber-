import { sql } from '@/lib/db'
import { modelSessionFrom } from '@/lib/model-auth'

type Params = { params: Promise<{ job: string }> }

/**
 * The cover frame for her app (Geno, 2026-10-12): the same poster thumbnail
 * the console grid shows, served to a model session instead of a team one.
 * Immutable once a job finishes, so the phone can hold it forever.
 */
export async function GET(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return new Response('unauthorized', { status: 401 })

  const { job } = await params
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(job)) return new Response('not found', { status: 404 })

  const [row] = await sql.query(
    `select thumbnail from transcriber.transcripts where job_id = $1`,
    [job],
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
