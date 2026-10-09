import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { healthData } from '@/lib/reddit/queries'

/** Collection health: last run, queue, errors, API budget and worker state. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await healthData())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
