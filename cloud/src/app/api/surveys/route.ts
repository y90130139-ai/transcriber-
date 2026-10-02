import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { requestAll, statuses } from '@/lib/survey/store'

/** Where every model's questionnaire stands, for the roster and profile. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ items: await statuses() })
}

/** "Send to everyone who hasn't answered." */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, ...(await requestAll()) })
}
