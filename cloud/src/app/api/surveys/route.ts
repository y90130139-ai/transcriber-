import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { requestAll, statuses } from '@/lib/survey/store'

/** Where every model's questionnaire stands, for the roster and profile. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  return NextResponse.json({ items: await statuses() })
}

/** "Send to everyone who hasn't answered." */
export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  return NextResponse.json({ ok: true, ...(await requestAll()) })
}
