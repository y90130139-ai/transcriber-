import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { collectDiscovery } from '@/lib/reddit/collect'
import { getSettings } from '@/lib/reddit/settings'

/** A manual discovery sweep: one pass of /subreddits/search pages over the
 *  rotating keyword list, inside the day's remaining allowance. */
export const maxDuration = 60

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const settings = await getSettings()
    const result = await collectDiscovery({
      trigger: 'manual',
      budget: Math.max(1, settings.discovery_per_pass),
    })
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
