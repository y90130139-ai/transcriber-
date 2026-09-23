import { NextResponse } from 'next/server'
import { modelForToken } from '@/lib/plans'
import { rateLimit } from '@/lib/ratelimit'
import { runFor } from '@/lib/run'

type Params = { params: Promise<{ token: string }> }

/**
 * Her own numbers, for her own page.
 *
 * Read-only and scoped to the token she already holds, so it exposes nothing
 * the plan behind that token does not. Fetched on the tap rather than with the
 * page: the run is a thing she opens sometimes, and putting a bank read and a
 * cadence read in front of every plan render would slow the screen she opens
 * every day to speed up the one she opens on Sundays.
 */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params
  if (!rateLimit(`run:${token}`, 60)) {
    return NextResponse.json({ error: 'slow_down' }, { status: 429 })
  }

  const model = await modelForToken(token)
  if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const run = await runFor(model.id)
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(run)
}
