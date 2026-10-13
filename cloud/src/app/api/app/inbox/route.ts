import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createThread, threadsForModel } from '@/lib/inbox'
import { modelSessionFrom } from '@/lib/model-auth'

/**
 * Her inbox (Geno, 2026-10-12): the threads she is in, newest first. POST
 * starts a chat with the team when there is nothing to reply to yet — she is
 * the only member, the console sees it like any other thread.
 */
export async function GET(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const threads = await threadsForModel(session.modelId)
  return NextResponse.json({ ok: true, threads })
}

export async function POST(request: Request) {
  const session = await modelSessionFrom(request)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [model] = await sql.query(`select name from transcriber.models where id = $1`, [session.modelId])
  const id = await createThread({
    title: null,
    createdBy: session.modelId,
    members: [{ type: 'model', id: session.modelId, name: (model?.name as string | null) ?? session.name }],
  })
  return NextResponse.json({ ok: true, id })
}
