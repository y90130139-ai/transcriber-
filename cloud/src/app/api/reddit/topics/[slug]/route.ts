import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { topicDetail } from '@/lib/reddit/queries'

/** One topic, whole: history, keywords, communities, contributing posts,
 *  engagement, acceleration and related trends. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { slug } = await params
  try {
    const detail = await topicDetail(slug)
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
