import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { searchAll } from '@/lib/reddit/queries'

/** Search the collected corpus: titles, topics, communities and mentions. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim()
  if (query.length < 2) {
    return NextResponse.json({ query, counts: { posts: 0, topics: 0, subreddits: 0, mentions: 0 }, posts: [], topics: [], subreddits: [], mentions: [] })
  }
  try {
    return NextResponse.json(await searchAll(query.slice(0, 120)))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
