import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, error } = await request.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await sql.query(
    `update transcriber.jobs
        set status = 'failed', stage = null, error = $2, updated_at = now()
      where id = $1`,
    [id, typeof error === 'string' ? error.slice(0, 1000) : 'unknown error'],
  )
  return NextResponse.json({ ok: true })
}
