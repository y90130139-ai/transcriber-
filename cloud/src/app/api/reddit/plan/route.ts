import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { planData } from '@/lib/reddit/queries'

/** The Today board: communities with their measured gates and heat, the
 *  topics currently heating, and the handful of counts the strip shows —
 *  one join of the cached tables, no Reddit calls. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    return NextResponse.json(await planData())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
