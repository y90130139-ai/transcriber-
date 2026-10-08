import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { interestOverTime } from '@/lib/trends'
import { cleanGeo, cleanInterestRange, parseInterestQuery } from '@/lib/trends-feed'

/** Interest over time for a search — the graph behind the Trends hero
 *  (2026-10-08). One `term` param per series (up to five, Google's cap),
 *  `?geo=US|US-XX&range=<Google range id>`; the answer is Google's 0–100
 *  relative interest per point, cached server-side for fifteen minutes. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const terms = parseInterestQuery(url.searchParams.getAll('term').join(','))
  const geo = cleanGeo(url.searchParams.get('geo'))
  const range = cleanInterestRange(url.searchParams.get('range'))
  if (terms.length === 0) return NextResponse.json({ error: 'no terms' }, { status: 400 })
  try {
    const points = await interestOverTime(terms, geo, range)
    return NextResponse.json({ terms, geo, range, points })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}
