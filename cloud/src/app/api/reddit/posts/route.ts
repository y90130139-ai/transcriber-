import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { postRows, rangeWindow, type PostQuery } from '@/lib/reddit/queries'

const SORTS: PostQuery['sort'][] = ['velocity', 'score', 'comments', 'recent', 'oldest']

/** The Posts board: every collected post with a measured velocity. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const sort = SORTS.includes(params.get('sort') as PostQuery['sort'])
    ? (params.get('sort') as PostQuery['sort'])
    : 'velocity'
  const range = params.get('range')
  const window = range ? rangeWindow(
    range === '1h' || range === '6h' || range === '24h' || range === '7d' || range === '30d' || range === '90d'
      ? range
      : '7d',
    params.get('from'),
    params.get('to'),
  ) : undefined
  try {
    const rows = await postRows({
      subreddit: params.get('subreddit'),
      category: params.get('category'),
      listing: params.get('listing'),
      search: params.get('q'),
      over18: params.get('adult') === '1' ? true : params.get('adult') === '0' ? false : null,
      sort,
      window,
      limit: Number(params.get('limit') ?? 50),
      offset: Number(params.get('offset') ?? 0),
    })
    return NextResponse.json({ rows, sort })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
