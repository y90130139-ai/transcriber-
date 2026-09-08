import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { clearTrash, recordPurged, recordUploaded } from '@/lib/r2queue'

/** The Mac reports back what it moved into R2 and what it reclaimed out of it. */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))

  const uploaded = Array.isArray(body.uploaded) ? body.uploaded : []
  for (const entry of uploaded) {
    if (typeof entry?.id !== 'string' || typeof entry?.key !== 'string') continue
    const bytes = Number(entry.bytes)
    await recordUploaded(entry.id, entry.key, Number.isFinite(bytes) ? bytes : null)
  }

  const purged = Array.isArray(body.purged)
    ? body.purged.filter((id: unknown): id is string => typeof id === 'string')
    : []
  await recordPurged(purged)

  const trashed = Array.isArray(body.trashed)
    ? body.trashed.filter((key: unknown): key is string => typeof key === 'string')
    : []
  await clearTrash(trashed)

  return NextResponse.json({ ok: true, uploaded: uploaded.length, purged: purged.length })
}
