import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { dueReminders } from '@/lib/reminders-db'
import { sql } from '@/lib/db'

/** Plan nudges due right now, for the Gosian bot to post in each model's
 *  MARKETING topic. See lib/reminders.ts for the windows and the rules. */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const origin = new URL(request.url).origin
  const due = await dueReminders()
  const tokens = due.length
    ? await sql.query(
        `select id, access_token from transcriber.models where id = any($1::text[])`,
        [due.map((nudge) => nudge.model_id)],
      )
    : []
  const tokenOf = new Map(tokens.map((row) => [String(row.id), String(row.access_token)]))
  return NextResponse.json({
    items: due.map((nudge) => ({
      ...nudge,
      link: `${origin}/p/${tokenOf.get(nudge.model_id) ?? ''}`,
    })),
  })
}
