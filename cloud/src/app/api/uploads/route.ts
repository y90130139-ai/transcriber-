import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { nanoid } from 'nanoid'
import { sql } from '@/lib/db'
import { findGerman } from '@/lib/german'
import { appendItems } from '@/lib/models'
import { isValidTag } from '@/lib/taxonomy'

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
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const denied = await guardAccess(request)
        if (denied) throw new Error('unauthorized')
        // A drop in the plan editor carries the week it is for; the id rides
        // the token because the completion callback has no other context.
        const asked = (() => {
          try {
            return JSON.parse(clientPayload ?? '{}') as {
              plan_id?: unknown; format?: unknown; variant?: unknown; name?: unknown
            }
          } catch { return {} as Record<string, unknown> }
        })()
        const planId = typeof asked.plan_id === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(asked.plan_id)
          ? asked.plan_id : null
        // The queue's three-column composer: a dropped file can arrive already
        // identified. Validated here, where the session is; the completion
        // callback just applies what the token carries.
        const format = typeof asked.format === 'string' && asked.format && (
          isValidTag('format', asked.format) ||
          (await sql.query(`select 1 from transcriber.custom_formats where id = $1`, [asked.format])).length > 0
        ) ? asked.format : null
        const variant = format === 'german' && typeof asked.variant === 'string' && findGerman(asked.variant)
          ? asked.variant : null
        const given = typeof asked.name === 'string' ? asked.name.trim().slice(0, 120) : ''
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            name: pathname.split('/').pop() ?? 'clip',
            plan_id: planId, format, variant, given: given || null,
          }),
        }
      },
      // Uploads get a speech pass like everything else; what it hears sets the
      // label. The plan id survives the trip through Blob so a file dropped on
      // a week lands on that week as a card, through every appendItems guard.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { name, plan_id, format, variant, given } = JSON.parse(tokenPayload || '{}')
        const german = format === 'german' && typeof variant === 'string' ? findGerman(variant) : null
        const label = german
          ? `German #${german.no} · ${german.name}`
          : (typeof given === 'string' && given) || name || blob.pathname
        const [job] = await sql.query(
          `insert into transcriber.jobs (id, kind, source, source_key, label)
           values ($1, 'file', $2, $2, $3)
           on conflict (source_key) do nothing
           returning id`,
          [nanoid(12), blob.url, label],
        )
        if (job && typeof format === 'string' && format) {
          await sql.query(
            `insert into transcriber.tags (job_id, axis, tag, origin, score)
             values ($1, 'format', $2, 'human', 1)
             on conflict do nothing`,
            [String(job.id), format],
          )
        }
        if (typeof plan_id === 'string' && plan_id && job) {
          const [plan] = await sql.query(
            `select id, model_id from transcriber.plans where id = $1`, [plan_id],
          )
          if (plan) await appendItems(String(plan.id), String(plan.model_id), [String(job.id)])
        }
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload failed'
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 400 })
  }
}
