import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { MEDIAN_DAYS, THRESHOLD, mixFor, winners } from '@/lib/mix'

/** How one creator's recent reels grade against 70/20/10, and the winners the
 *  70% would be drawn from. Reports only — it does not pick anything yet. */
export async function GET(request: Request, ctx: { params: Promise<{ handle: string }> }) {
  if (!(await isSignedIn())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { handle: raw } = await ctx.params
  const handle = raw.replace(/^@/, '').trim().toLowerCase()
  if (!handle) return NextResponse.json({ error: 'handle is required' }, { status: 400 })

  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || MEDIAN_DAYS, 7), 365)
  const [mix, graded] = await Promise.all([mixFor(handle, days), winners(handle, days)])
  return NextResponse.json({
    ...mix,
    thresholds: THRESHOLD,
    // Her strongest first: this is the pool the reskins come out of.
    winners: graded.filter((g) => g.band === 'reskin').slice(0, 20),
    iterations: graded.filter((g) => g.band === 'iteration').slice(0, 20),
  })
}
