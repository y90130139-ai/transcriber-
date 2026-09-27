import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { dueShoutouts } from '@/lib/performance/shoutouts'

/** Shout-outs due now, for the Gosian bot to post in each model's MARKETING
 *  topic. See lib/performance/shoutouts.ts for who qualifies and when. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ items: await dueShoutouts() })
}
