import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { ingestHers } from '@/lib/hers'
import { weekFor } from '@/lib/split'

type Params = { params: Promise<{ id: string }> }

/** Her week as 70/20/10 would build it: reskins of her own winners, iterations
 *  of her middle, and the library sized back to the experiment budget it was
 *  always good at. Read-only — proposing, not writing. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const week = await weekFor(id)
  if (!week) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(week)
}

/** Put her graded posts through the library pipeline, so a reskin card has a
 *  clip and a transcript behind it rather than a bare shortcode. */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const result = await ingestHers(id)
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(result)
}
