import { NextResponse } from 'next/server'
import { guardAccess } from '@/lib/access'
import { TARGET, cadence, growth, topPosts } from '@/lib/analytics'

/** One account's scorecard: what they post, how often, how it does, and
 *  whether a story went up. Same answer for a watched creator and for one of
 *  ours — only the reason for asking differs. */
export async function GET(request: Request, ctx: { params: Promise<{ handle: string }> }) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const { handle: raw } = await ctx.params
  const handle = raw.replace(/^@/, '').trim().toLowerCase()
  if (!handle) return NextResponse.json({ error: 'handle is required' }, { status: 400 })

  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 30, 1), 365)
  const [pace, top, grew] = await Promise.all([
    cadence(handle, days),
    topPosts(handle, days),
    growth(handle, days),
  ])
  return NextResponse.json({ handle, target: TARGET, cadence: pace, top: top, growth: grew })
}
