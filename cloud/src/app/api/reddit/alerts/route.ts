import { guardAccess } from '@/lib/access'
import { NextResponse } from 'next/server'
import { alertsList, alertsUnseenCount } from '@/lib/reddit/queries'
import { markAlertSeen, markAllAlertsSeen } from '@/lib/reddit/store'

/** The alert centre. Every event is written once (dedupe keys at write
 *  time); this route only marks them seen. */
export async function GET(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 50)))
  try {
    const [rows, unseen] = await Promise.all([alertsList(limit), alertsUnseenCount()])
    return NextResponse.json({ rows, unseen })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const denied = await guardAccess(request)
  if (denied) return denied
  try {
    const body = await request.json().catch(() => ({}))
    if (body.all === true) await markAllAlertsSeen()
    else if (body.id) await markAlertSeen(String(body.id))
    return NextResponse.json({ ok: true, unseen: await alertsUnseenCount() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
