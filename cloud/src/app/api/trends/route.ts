import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { ingestTrends, trendsBoard } from '@/lib/trends'

/** The Trends board: Google's terms as last pulled, the library's own
 *  breakouts and the sounds spreading across watched accounts. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json(await trendsBoard())
}

/** Pull Google's feed now rather than waiting for the 10:00 cron — the
 *  button on the tab, and the first run's only way to have data today. */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const pulled = await ingestTrends()
    return NextResponse.json({ ...pulled, board: await trendsBoard() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}
