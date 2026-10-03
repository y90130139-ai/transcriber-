import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { sql } from '@/lib/db'

const MAX_TOPICS = 20
const MAX_TOTAL = 200_000

/** The bot's hourly snapshot of its own data, for the /q assistant. */
export async function PUT(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { generated_at?: unknown; topics?: unknown } | null
  const topics = body?.topics
  const when = Date.parse(String(body?.generated_at ?? ''))
  if (!topics || typeof topics !== 'object' || Array.isArray(topics) || !Number.isFinite(when)) {
    return NextResponse.json({ error: 'generated_at and a topics object are required' }, { status: 400 })
  }
  const entries = Object.entries(topics as Record<string, unknown>)
    .filter(([key, value]) => /^[a-z0-9_]{1,40}$/.test(key) && typeof value === 'string')
    .slice(0, MAX_TOPICS)
  const clean = Object.fromEntries(entries)
  if (JSON.stringify(clean).length > MAX_TOTAL) return NextResponse.json({ error: 'snapshot too large' }, { status: 413 })
  await sql.query(
    `insert into transcriber.bot_snapshot (id, generated_at, topics) values ('latest', $1, $2)
     on conflict (id) do update set generated_at = excluded.generated_at, topics = excluded.topics, received_at = now()`,
    [new Date(when).toISOString(), JSON.stringify(clean)],
  )
  return NextResponse.json({ stored: entries.length })
}
