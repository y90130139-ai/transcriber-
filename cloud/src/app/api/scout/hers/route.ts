import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { ingestHers } from '@/lib/hers'

export const maxDuration = 60

/**
 * Queue every active model's winners for download, right after the roster pass.
 *
 * The pass has just graded her posts and read fresh links for them, so this is
 * the one moment a new winner can be fetched without a login. Called by the
 * Mac (`bin/scout --roster`, Saturdays), which is why it takes the worker
 * secret. Idempotent: an already-queued reel is not queued twice.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const models = await sql.query(`select id from transcriber.models where status = 'active'`)
  let queued = 0
  let considered = 0
  for (const model of models) {
    const result = await ingestHers(String(model.id))
    queued += result?.queued ?? 0
    considered += result?.considered ?? 0
  }
  return NextResponse.json({ models: models.length, considered, queued })
}
