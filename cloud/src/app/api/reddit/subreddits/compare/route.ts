import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { subredditCompare } from '@/lib/reddit/queries'

/** Side-by-side comparison for up to six communities. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
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
