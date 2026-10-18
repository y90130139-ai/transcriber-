import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { topicDetail } from '@/lib/reddit/queries'

/** One topic, whole: history, keywords, communities, contributing posts,
 *  engagement, acceleration and related trends. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { slug } = await params
  try {
    const detail = await topicDetail(slug)
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
