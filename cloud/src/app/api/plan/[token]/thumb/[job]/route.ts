import { sql } from '@/lib/db'
import { modelForToken } from '@/lib/plans'
import { instagramAccounts, readSocials } from '@/lib/socials'

type Params = { params: Promise<{ token: string; job: string }> }

/**
 * A poster frame for her run, on her phone.
 *
 * `/api/thumb/[id]` needs a console session, which she does not have and must
 * never be given — so every still in her run rendered as a broken image
 * (2026-09-23, her screenshot: a blue question mark where each reel should be).
 *
 * The token authorises this the same way it authorises her plan, and the reel
 * has to be **hers**: the author on the transcript must be one of the Instagram
 * accounts on her own profile. Without that check a plan token would read a
 * poster frame for any job id in the library, which is a different thing
 * entirely from reading her own week.
 */
export async function GET(_request: Request, { params }: Params) {
  const { token, job } = await params

  const model = await modelForToken(token)
  if (!model) return new Response('not found', { status: 404 })

  const [row] = await sql.query(
    `select handle, socials from transcriber.models where id = $1`,
    [model.id],
  )
  const hers = instagramAccounts(row?.handle as string | null, readSocials(row?.socials))
  if (hers.length === 0) return new Response('not found', { status: 404 })

  const [reel] = await sql.query(
    `select thumbnail from transcriber.transcripts
      where job_id = $1 and lower(author) = any($2::text[])`,
    [job, hers.map((handle) => handle.toLowerCase())],
  )

  const dataUrl = reel?.thumbnail as string | undefined
  const match = dataUrl?.match(/^data:(image\/[a-z+]+);base64,(.+)$/s)
  if (!match) return new Response('not found', { status: 404 })

  return new Response(Buffer.from(match[2], 'base64') as unknown as BodyInit, {
    headers: {
      'Content-Type': match[1],
      // Immutable once the job finished, and private: it is her own reel.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
