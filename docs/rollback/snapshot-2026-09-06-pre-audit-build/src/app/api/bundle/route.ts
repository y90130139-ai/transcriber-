import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { sql } from '@/lib/db'
import { bundleLink, mediaBase } from '@/lib/media'

const MAX_ITEMS = 60

/** Turn a multi-select into one signed zip URL served off the Mac. */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, MAX_ITEMS)
    : []
  if (ids.length === 0) return NextResponse.json({ error: 'nothing selected' }, { status: 400 })

  const base = await mediaBase()
  if (!base) {
    return NextResponse.json(
      { error: 'The Mac is not reachable, so the videos are not either.' },
      { status: 503 },
    )
  }

  const rows = await sql.query(
    `select folder from transcriber.transcripts
      where job_id = any($1::text[]) and folder is not null`,
    [ids],
  )
  const folders = rows.map((row) => String(row.folder))
  if (folders.length === 0) {
    return NextResponse.json({ error: 'none of those have a video on disk' }, { status: 404 })
  }

  return NextResponse.json({ url: bundleLink(base, folders), count: folders.length })
}
