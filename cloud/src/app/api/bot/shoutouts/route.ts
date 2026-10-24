import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { dueShoutouts } from '@/lib/performance/shoutouts'

/** Shout-outs due now, for the Gosian bot to post in each model's MARKETING
 *  topic. See lib/performance/shoutouts.ts for who qualifies and when. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ items: await dueShoutouts() })
  } catch (error: unknown) {
    // The bot asks every minute. A thrown read used to answer 500 on every one
    // of those, which says nothing about what broke and buries it in noise.
    // Nothing due is the safe answer: a shout-out is only ever skipped, and the
    // next minute retries. The reason is logged once, with the error named.
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[bot/shoutouts] dueShoutouts failed, answering empty:', reason)
    return NextResponse.json({ items: [], error: reason }, { status: 200 })
  }
}
