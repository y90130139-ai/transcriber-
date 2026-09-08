import { NextResponse } from 'next/server'
import { isSignedIn, isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'
import { autoTag } from '@/lib/tagging'

export const maxDuration = 60

/** Re-run the suggester across the library.
 *
 * Needed twice: once to tag everything transcribed before tagging existed, and
 * again whenever the lexicon learns a phrase. Confirmed tags are never touched,
 * so this is safe to run repeatedly. */
export async function POST(request: Request) {
  const allowed = isWorker(request) || (await isSignedIn())
  if (!allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const all = new URL(request.url).searchParams.get('all') === '1'
  const rows = await sql.query(
    `select job_id from transcriber.transcripts
      where ${all ? 'true' : 'tagged_at is null'}
      order by transcribed_at desc
      limit 400`,
  )

  let tagged = 0
  for (const row of rows) {
    tagged += (await autoTag(row.job_id as string)) > 0 ? 1 : 0
  }
  return NextResponse.json({ considered: rows.length, tagged })
}
