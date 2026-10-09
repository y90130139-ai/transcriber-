import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { subredditCompare } from '@/lib/reddit/queries'

/** Side-by-side comparison for up to six communities. */
export async function GET(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: 'ids is required' }, { status: 400 })
  try {
    return NextResponse.json({ rows: await subredditCompare(ids) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
