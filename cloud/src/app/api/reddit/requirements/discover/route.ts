import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { collectDiscovery } from '@/lib/reddit/collect'
import { getSettings } from '@/lib/reddit/settings'

/** A manual discovery sweep: one pass of /subreddits/search pages over the
 *  rotating keyword list, inside the day's remaining allowance. */
export const maxDuration = 60

export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
