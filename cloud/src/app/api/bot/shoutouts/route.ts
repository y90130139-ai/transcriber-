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
    // Nothing due is the safe answer for the item itself: a shout-out is only
    // ever skipped, and the next minute retries.
    //
    // What a 200 costs is the signal, so the reason is carried in `error` as
    // well as logged, and the bot warns on it (gosian-bot drainShoutouts).
    // Otherwise a dead DATABASE_URL reads as a quiet day - and the weekly
    // round-up has a window (Monday noon to Tuesday) it could miss entirely.
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[bot/shoutouts] dueShoutouts failed, answering empty:', reason)
    return NextResponse.json({ items: [], error: reason }, { status: 200 })
  }
}
