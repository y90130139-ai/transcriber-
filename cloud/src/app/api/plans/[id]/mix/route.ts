import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { mixOf } from '@/lib/mix'

/** What this week actually consists of, against the 70/20/10 rule. Reports
 *  only — nothing here changes what was picked. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const mix = await mixOf(id)
  if (!mix) return NextResponse.json({ error: 'no such plan' }, { status: 404 })
  return NextResponse.json(mix)
}
