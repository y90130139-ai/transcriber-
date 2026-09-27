import { NextResponse } from 'next/server'
import { isBot } from '@/lib/auth'
import { sql } from '@/lib/db'

/** How old a question can be and still be relayed. Linking a model to her
 *  group later must not post a week of stale questions into it. */
const FRESH_HOURS = 72

/**
 * Her questions from the plan ("Ask about this one"), for the Gosian bot to
 * post in her MARKETING topic and in OPS (Geno, 2026-09-27: both). Until this
 * they sat in the console, and no model ever used the box — they sent
 * screenshots to Geno's DMs instead.
 */
export async function GET(request: Request) {
  if (!isBot(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const origin = new URL(request.url).origin
  const rows = await sql.query(
    `select n.id, n.body, m.name as model_name, m.telegram_chat_id as chat_id, m.access_token,
            i.card_no, i.title as card_title
       from transcriber.plan_messages n
       join transcriber.plan_items i on i.id = n.item_id
       join transcriber.plans p on p.id = i.plan_id
       join transcriber.models m on m.id = p.model_id
      where n.author = 'model' and n.relayed_at is null and n.relay_error is null
        and n.created_at > now() - interval '${FRESH_HOURS} hours'
        and m.telegram_chat_id is not null
      order by n.created_at
      limit 20`,
  )
  return NextResponse.json({
    items: rows.map(({ access_token, card_no, ...row }) => ({
      ...row,
      card: card_no ? `V-${card_no}` : null,
      link: `${origin}/p/${access_token}`,
    })),
  })
}
