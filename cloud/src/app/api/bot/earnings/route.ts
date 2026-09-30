import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { botQueue } from '@/lib/earnings/queue'

/** For the Gosian bot, once a minute: drafts to show in OPS with Approve /
 *  Skip, approved messages to deliver, and OPS-only alerts to post. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json(await botQueue())
}
