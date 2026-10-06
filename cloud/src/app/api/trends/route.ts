import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { ingestTrends, liveTrends, trendsBoard } from '@/lib/trends'
import { cleanGeo, cleanRange } from '@/lib/trends-feed'

/** The Trends board: Google's live Trending Now list for the asked place
 *  and window (`?days=1|2|3|7&geo=US|US-XX`), the library's own breakouts
 *  and the sounds spreading across watched accounts. The daily-archive
 *  terms ride along as the fallback for a day Google will not answer. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const days = cleanRange(url.searchParams.get('days'))
  const geo = cleanGeo(url.searchParams.get('geo'))
  const [board, live] = await Promise.all([trendsBoard(days), liveTrends(geo, days)])
  return NextResponse.json({ ...board, live, geo })
}

/** Pull Google's feed now rather than waiting for the 10:00 cron — the
 *  button on the tab, and the first run's only way to have data today. */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const days = cleanRange(new URL(request.url).searchParams.get('days'))
  try {
    const pulled = await ingestTrends()
    return NextResponse.json({ ...pulled, board: await trendsBoard(days) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}
