import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { note, media_url: mediaUrl } = await request.json().catch(() => ({}))

  // A quick tunnel is reissued a hostname on every restart, so the worker
  // reports the live one instead of the app holding a configured guess.
  const media =
    typeof mediaUrl === 'string' && /^https:\/\/[\w.-]+$/.test(mediaUrl.replace(/\/+$/, ''))
      ? mediaUrl.replace(/\/+$/, '')
      : null

  await sql.query(
    `insert into transcriber.worker_pings (id, seen_at, note, media_url)
     values (1, now(), $1, $2)
     on conflict (id) do update
        set seen_at = now(),
            note = excluded.note,
            -- Overwritten, not coalesced: if the tunnel died the worker reports
            -- null, and a remembered hostname would hand out links to nothing.
            media_url = excluded.media_url`,
    [typeof note === 'string' ? note.slice(0, 200) : null, media],
  )
  return NextResponse.json({ ok: true })
}
