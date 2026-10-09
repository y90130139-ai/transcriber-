import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { topicRows } from '@/lib/reddit/queries'
import { TOPIC_CATEGORIES } from '@/lib/reddit/registry'

/** The Topics board: adult-creator entities with a latest reading, grouped by
 *  category on the page. Rows open the topic detail view. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const rows = await topicRows({ sort: 'interest', limit: 500 })
    return NextResponse.json({
      rows,
      categories: TOPIC_CATEGORIES,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
