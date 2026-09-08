import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

/** Library rows nobody has ever listened to.
 *
 * Everything fetched before the speech pass became unconditional could be added
 * without one, so those rows have a poster and figures but no answer to whether
 * anyone talks. `has_speech is null` is exactly that state — and is not the same
 * statement as false, which means "listened, heard nobody".
 *
 * The Mac asks for this list and re-listens from the copy of the video it still
 * has on disk, so nothing is re-fetched. See `./bin/relisten`.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const items = await sql.query(
    `select t.job_id, t.folder
       from transcriber.transcripts t
       join transcriber.jobs j on j.id = t.job_id
      where t.has_speech is null and t.folder is not null and j.status = 'done'
      order by t.transcribed_at asc`,
  )
  return NextResponse.json({ items })
}
