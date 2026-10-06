import { sql } from '@/lib/db'
import { modelForToken } from '@/lib/plans'
import { wasDealt } from '@/lib/discover'

type Params = { params: Promise<{ token: string; job: string }> }

/** A poster frame for a card in her deck. Gated on the deal: only jobs that
 *  Discover itself dealt to this model are readable, so a plan token still
 *  cannot read poster frames for arbitrary library ids. */
export async function GET(_request: Request, { params }: Params) {
  const { token, job } = await params
  const model = await modelForToken(token)
  if (!model) return new Response('not found', { status: 404 })
  if (!(await wasDealt(model.id, job))) return new Response('not found', { status: 404 })

  const [reel] = await sql.query(
    `select thumbnail from transcriber.transcripts where job_id = $1`,
    [job],
  )
  const dataUrl = reel?.thumbnail as string | undefined
  const match = dataUrl?.match(/^data:(image\/[a-z+]+);base64,(.+)$/s)
  if (!match) return new Response('not found', { status: 404 })

  return new Response(Buffer.from(match[2], 'base64') as unknown as BodyInit, {
    headers: {
      'Content-Type': match[1],
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
