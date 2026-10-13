import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { isInboxKey, threadIdOfKey } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'
import { presignGet, r2Config } from '@/lib/r2'

type Params = { params: Promise<{ key: string[] }> }

/** A file in her thread (2026-10-12): presigned read, but only for a thread
 *  she is in — the key alone is not a key. A forwarded file also opens when
 *  it is attached to a message in one of her own threads, so the copy keeps
 *  its picture without a second upload (2026-10-13). */
export async function GET(request: Request, { params }: Params) {
  const session = await modelSessionFrom(request)
  if (!session) return new Response('unauthorized', { status: 401 })

  const { key } = await params
  const joined = (key ?? []).join('/')
  if (!isInboxKey(joined)) return new Response('not found', { status: 404 })

  const [member] = await sql.query(
    `select 1 from transcriber.thread_members
      where thread_id = $1 and member_type = 'model' and member_id = $2
     union all
     select 1 from transcriber.thread_messages m
       join transcriber.thread_members tm on tm.thread_id = m.thread_id
      where m.attachment_key = $3 and tm.member_type = 'model' and tm.member_id = $2
     limit 1`,
    [threadIdOfKey(joined), session.modelId, joined],
  )
  if (!member) return new Response('not found', { status: 404 })

  const config = r2Config()
  if (!config) return new Response('not found', { status: 404 })
  return NextResponse.redirect(presignGet(config, joined, { ttlSec: 6 * 60 * 60 }))
}
