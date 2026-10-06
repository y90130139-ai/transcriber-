import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { ingestTrends, trendsBoard } from '@/lib/trends'
import { cleanRange } from '@/lib/trends-feed'

/** The Trends board: Google's terms over the asked window (`?days=1|2|3|7`),
 *  the library's own breakouts and the sounds spreading across watched
 *  accounts over the same window. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const days = cleanRange(new URL(request.url).searchParams.get('days'))
  return NextResponse.json(await trendsBoard(days))
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
