import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { autoTag, setTags, tagsFor } from '@/lib/tagging'
import { isAxis } from '@/lib/taxonomy'

type Params = { params: Promise<{ id: string }> }

/** Confirm or correct one axis. What a human sets replaces the guess entirely. */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (typeof body.axis !== 'string' || !isAxis(body.axis)) {
    return NextResponse.json({ error: 'axis must be persona, format or hook' }, { status: 400 })
  }
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : []
  await setTags(id, body.axis, tags)
  return NextResponse.json({ tags: await tagsFor(id) })
}

/** Re-run the suggester, for an item tagged before the lexicon knew better. */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const added = await autoTag(id)
  return NextResponse.json({ added, tags: await tagsFor(id) })
}
