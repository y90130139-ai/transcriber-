import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

/** Library rows nothing has ever looked at.
 *
 * Everything added before the visual pass existed carries a transcript but no
 * answer to "what does the screen say". `has_looked is null` is exactly that
 * state — and, exactly as with `has_speech`, it is NOT the same statement as
 * false, which means "looked, found no text on screen". Reading null as false
 * would re-OCR every wordless video forever.
 *
 * This matters most for the videos nobody speaks in: measured 2026-09-06 on the
 * Mac, 44 of the 50 silent folders (88%) carry on-screen text, and without it
 * every one of them lands on the same placeholder hook tag.
 *
 * The Mac asks for this list and reads the copy of the video it still has on
 * disk, so nothing is re-fetched and a since-gated post stays safe.
 * See `./bin/relook`.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const items = await sql.query(
    `select t.job_id, t.folder
       from transcriber.transcripts t
       join transcriber.jobs j on j.id = t.job_id
      where t.has_looked is null and t.folder is not null and j.status = 'done'
      order by (t.has_speech is false) desc, t.transcribed_at asc`,
  )
  return NextResponse.json({ items })
}
