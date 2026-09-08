import { NextResponse } from 'next/server'
import { isWorker } from '@/lib/auth'
import { reconcileBucket, type BucketObject } from '@/lib/r2queue'

/** One listing is capped here as well as on the Mac; a body larger than this
 *  is a bug rather than a bucket. */
const MAX_OBJECTS = 10_000

export const maxDuration = 60

/**
 * What the bucket actually holds, checked against what the ledger thinks.
 *
 * `orphanedKeys` can only see objects the app's own delete routes wrote to
 * `r2_trash`. Anything removed another way leaves an object nothing will ever
 * ask about again, and R2 bills for it forever. The Mac lists the bucket —
 * it is the only side with credentials that can — and posts the listing here.
 *
 * A partial listing is refused outright. Reading half a bucket as the whole
 * one would mark every object in the unlisted half an orphan, and the reply
 * to that is a delete.
 */
export async function POST(request: Request) {
  if (!isWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (body.complete !== true) {
    return NextResponse.json({ error: 'a partial listing cannot be reconciled' }, { status: 400 })
  }

  const objects: BucketObject[] = (Array.isArray(body.objects) ? body.objects : [])
    .filter((entry: unknown): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && typeof (entry as { key?: unknown }).key === 'string')
    .slice(0, MAX_OBJECTS)
    .map((entry: Record<string, unknown>) => ({
      key: String(entry.key),
      modified: typeof entry.modified === 'string' ? entry.modified : null,
    }))

  return NextResponse.json(await reconcileBucket(objects))
}
