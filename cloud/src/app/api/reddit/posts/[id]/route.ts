import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { postDetail } from '@/lib/reddit/queries'

/** One post: performance graph, snapshot history, topic associations,
 *  related posts, and the direct link to the source. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const detail = await postDetail(id)
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
