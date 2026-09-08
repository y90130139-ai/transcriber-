import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, stage } = await request.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await sql.query(
    `update transcriber.jobs set stage = $2, updated_at = now()
      where id = $1 and status = 'running'`,
    [id, typeof stage === 'string' ? stage.slice(0, 120) : null],
  )
  return NextResponse.json({ ok: true })
}
