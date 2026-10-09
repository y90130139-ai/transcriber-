import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { topicRows, type TopicQuery } from '@/lib/reddit/queries'

const SORTS: TopicQuery['sort'][] = ['interest', 'growth', 'activity', 'velocity', 'freshness']

/** The Trending Now table: sortable, filterable, paginated. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const sort = SORTS.includes(params.get('sort') as TopicQuery['sort'])
    ? (params.get('sort') as TopicQuery['sort'])
    : 'interest'
  try {
    const rows = await topicRows({
      category: params.get('category'),
      status: params.get('status'),
      // The adult gate governs what may be *collected*; when those rows
      // exist, the tables show them. An explicit ?adult=1|0 narrows.
      adult: params.has('adult') ? params.get('adult') === '1' : undefined,
      search: params.get('q'),
      sort,
      limit: Number(params.get('limit') ?? 100),
      offset: Number(params.get('offset') ?? 0),
    })
    return NextResponse.json({ rows, sort })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
