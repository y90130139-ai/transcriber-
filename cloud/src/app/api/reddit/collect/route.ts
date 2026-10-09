import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { collect, collectRequirements, testConnection } from '@/lib/reddit/collect'
import { getSettings } from '@/lib/reddit/settings'

/** A manual collection from the console: run now, validate the queue, run a
 *  requirements pass, or test the connection. Bounded tighter than the
 *  cron's budget because a browser is waiting — the rest of the queue
 *  survives to the next run. */
export const maxDuration = 60

const MANUAL_BUDGET_CAP = 20

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const mode = String(body.mode ?? 'run')
    if (mode === 'test') {
      return NextResponse.json(await testConnection())
    }
    if (mode === 'validate') {
      const result = await collect({ trigger: 'validation' })
      return NextResponse.json({ mode, result })
    }
    if (mode === 'requirements') {
      const settings = await getSettings()
      const result = await collectRequirements({
        trigger: 'manual',
        budget: Math.max(2, Math.min(MANUAL_BUDGET_CAP, settings.requirements_budget_per_run)),
      })
      return NextResponse.json({ mode, result })
    }
    const settings = await getSettings()
    const result = await collect({
      trigger: 'manual',
      budget: Math.min(MANUAL_BUDGET_CAP, settings.budget_per_run),
    })
    return NextResponse.json({ mode: 'run', result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
