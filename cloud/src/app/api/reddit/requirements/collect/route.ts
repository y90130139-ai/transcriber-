import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { collectRequirements } from '@/lib/reddit/collect'
import { getSettings } from '@/lib/reddit/settings'

/** A manual requirements pass. Bounded tighter than the scheduler's because
 *  a browser is waiting; unclaimed work stays queued for the next pass. */
export const maxDuration = 60

const MANUAL_CAP = 15

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const settings = await getSettings()
    const budget = Math.max(2, Math.min(MANUAL_CAP, settings.requirements_budget_per_run))
    const result = await collectRequirements({ trigger: 'manual', budget })
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
