import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { dueAlerts } from '@/lib/assistant/watches'

export const maxDuration = 60

/** Alerts set with /q that have fired and are waiting to be posted. Polled by
 *  the Gosian bot every minute; held 23:00-09:00 New York. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ items: await dueAlerts() })
}
