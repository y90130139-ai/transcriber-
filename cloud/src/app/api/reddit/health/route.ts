import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { healthData } from '@/lib/reddit/queries'

/** Collection health: last run, queue, errors, API budget and worker state. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    return NextResponse.json(await healthData())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
