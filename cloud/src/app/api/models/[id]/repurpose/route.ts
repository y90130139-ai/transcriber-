import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { repurposeReel } from '@/lib/repurpose'

type Params = { params: Promise<{ id: string }> }
const SHORTCODE = /^[A-Za-z0-9_-]{5,20}$/

/** One of her top reels onto her week as a Repurpose card — `{ post_id,
 *  plan_id? }` — with a download link for the batcher. lib/repurpose.ts. */
export async function POST(request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const code = typeof body.post_id === 'string' ? body.post_id : ''
  if (!SHORTCODE.test(code)) return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  const result = await repurposeReel(id, code, body.plan_id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
