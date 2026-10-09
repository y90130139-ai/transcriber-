import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { cleanRange, overviewData } from '@/lib/reddit/queries'
import { seedRegistry } from '@/lib/reddit/store'

/** The Overview board: analytics cards, the interest/activity series with a
 *  previous-period overlay, trending and rising topics, top posts by
 *  velocity, collector health and the newest alerts — all from the cache. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const range = cleanRange(url.searchParams.get('range'))
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  try {
    // Onboarding safety net: a fresh install that opens the Overview first
    // still gets the registry seeded. Memoized, so this is one check.
    await seedRegistry().catch(() => null)
    return NextResponse.json(await overviewData(range, from, to, {
      category: url.searchParams.get('category'),
      subreddit: url.searchParams.get('subreddit'),
    }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
