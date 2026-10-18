import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { postDetail } from '@/lib/reddit/queries'

/** One post: performance graph, snapshot history, topic associations,
 *  related posts, and the direct link to the source. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { id } = await params
  try {
    const detail = await postDetail(id)
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
